import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, WebContentsView } from "electron";
import { startProductionServer, type ProductionServer } from "./production-server.js";

const DEFAULT_CLIENT_URL = "http://localhost:3000";
const CLIENT_START_TIMEOUT_MS = 30_000;
const CLIENT_POLL_INTERVAL_MS = 250;
const TITLE_BAR_HEIGHT = 40;
const isDevelopment = process.argv.includes("--dev");

const desktopDirectory = resolve(import.meta.dirname, "..");
const workspaceDirectory = resolve(desktopDirectory, "../..");
const applicationBuildDirectory = app.isPackaged
  ? resolve(process.resourcesPath, "autodekt-dist")
  : resolve(workspaceDirectory, "dist");

let clientUrl = new URL(process.env.AUTODEKT_CLIENT_URL ?? DEFAULT_CLIENT_URL);
let mainWindow: BrowserWindow | null = null;
let applicationView: WebContentsView | null = null;
let developmentProcess: ChildProcess | null = null;
let productionServer: ProductionServer | null = null;
let isQuitting = false;
let isSidebarOpen = true;

function sendNavigationState(): void {
  if (!mainWindow || !applicationView) return;
  const history = applicationView.webContents.navigationHistory;
  mainWindow.webContents.send("shell:navigation-state", {
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
  });
}

function sendSidebarState(): void {
  mainWindow?.webContents.send("shell:sidebar-state", { isOpen: isSidebarOpen });
}

function registerShellIpc(): void {
  ipcMain.on("shell:back", () => {
    const history = applicationView?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  });
  ipcMain.on("shell:forward", () => {
    const history = applicationView?.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  });
  ipcMain.on("shell:reload", () => applicationView?.webContents.reload());
  ipcMain.on("shell:toggle-sidebar", () => {
    applicationView?.webContents.send("desktop:toggle-sidebar");
  });
  ipcMain.on("desktop:sidebar-state", (event, state: unknown) => {
    if (event.sender !== applicationView?.webContents) return;
    if (
      typeof state !== "object" ||
      state === null ||
      !("isOpen" in state) ||
      typeof state.isOpen !== "boolean"
    ) {
      return;
    }
    isSidebarOpen = state.isOpen;
    sendSidebarState();
  });
}

async function isClientReady(): Promise<boolean> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 1_000);

  try {
    const response = await fetch(clientUrl, {
      method: "HEAD",
      signal: abortController.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function startDevelopmentClient(): void {
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArguments = isWindows ? ["/d", "/s", "/c", "pnpm dev"] : ["dev"];
  const childEnvironment = { ...process.env };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;

  developmentProcess = spawn(command, commandArguments, {
    cwd: workspaceDirectory,
    env: childEnvironment,
    stdio: "inherit",
    windowsHide: true,
  });

  developmentProcess.once("error", (error) => {
    dialog.showErrorBox(
      "Autodekt client failed to start",
      `Could not run the root development server.\n\n${error.message}`,
    );
    app.quit();
  });

  developmentProcess.once("exit", (code, signal) => {
    developmentProcess = null;
    if (isQuitting) return;

    const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
    dialog.showErrorBox(
      "Autodekt client stopped",
      `The root development server stopped unexpectedly (${reason}).`,
    );
    app.quit();
  });
}

async function waitForClient(): Promise<void> {
  const deadline = Date.now() + CLIENT_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isClientReady()) return;
    await new Promise<void>((resolvePoll) => {
      setTimeout(resolvePoll, CLIENT_POLL_INTERVAL_MS);
    });
  }

  throw new Error(
    `The client did not become available at ${clientUrl.origin} within ${CLIENT_START_TIMEOUT_MS / 1_000} seconds.`,
  );
}

async function startClient(): Promise<void> {
  if (isDevelopment) {
    if (!(await isClientReady()) && !process.env.AUTODEKT_CLIENT_URL) {
      startDevelopmentClient();
    }
    await waitForClient();
    return;
  }

  process.env.AUTODEKT_RUNTIME_DIRECTORY = resolve(app.getPath("userData"), "credentials");
  productionServer = await startProductionServer(applicationBuildDirectory);
  clientUrl = new URL(productionServer.origin);
}

function stopClient(): void {
  void productionServer?.close();
  productionServer = null;

  const processToStop = developmentProcess;
  developmentProcess = null;
  if (!processToStop?.pid || processToStop.killed) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(processToStop.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  processToStop.kill("SIGTERM");
}

function openExternalUrl(url: string): void {
  const target = new URL(url);
  if (target.protocol === "http:" || target.protocol === "https:") {
    void shell.openExternal(target.toString());
  }
}

function layoutApplicationView(): void {
  if (!mainWindow || !applicationView) return;
  const [width, height] = mainWindow.getContentSize();
  applicationView.setBounds({
    x: 0,
    y: TITLE_BAR_HEIGHT,
    width,
    height: Math.max(0, height - TITLE_BAR_HEIGHT),
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: "Autodekt",
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#101311",
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#17201c",
      symbolColor: "#d7ddd9",
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(desktopDirectory, "dist/preload.cjs"),
      sandbox: true,
    },
  });

  applicationView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(desktopDirectory, "dist/app-preload.cjs"),
      sandbox: true,
    },
  });
  mainWindow.contentView.addChildView(applicationView);
  layoutApplicationView();

  mainWindow.on("resize", layoutApplicationView);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  applicationView.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  applicationView.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin === clientUrl.origin) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  applicationView.webContents.on("did-navigate", sendNavigationState);
  applicationView.webContents.on("did-navigate-in-page", sendNavigationState);

  mainWindow.on("closed", () => {
    if (applicationView && !applicationView.webContents.isDestroyed()) {
      applicationView.webContents.close();
    }
    applicationView = null;
    mainWindow = null;
  });

  void mainWindow.loadFile(resolve(desktopDirectory, "shell/index.html"));
  mainWindow.webContents.once("did-finish-load", sendSidebarState);
  void applicationView.webContents.loadURL(clientUrl.toString());
}

Menu.setApplicationMenu(null);
registerShellIpc();

app.on("before-quit", () => {
  isQuitting = true;
  stopClient();
});

app.on("window-all-closed", () => app.quit());

app.on("activate", () => {
  if (!mainWindow) createWindow();
});

void app.whenReady().then(async () => {
  try {
    await startClient();
    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Autodekt could not open", message);
    app.quit();
  }
});
