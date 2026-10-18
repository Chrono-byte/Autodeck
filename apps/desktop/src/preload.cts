import { contextBridge, ipcRenderer } from "electron";

export type NavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
};

export type SidebarState = {
  isOpen: boolean;
};

export type DesktopShellApi = {
  goBack(): void;
  goForward(): void;
  reload(): void;
  toggleSidebar(): void;
  onNavigationStateChanged(callback: (state: NavigationState) => void): () => void;
  onSidebarStateChanged(callback: (state: SidebarState) => void): () => void;
};

const desktopShellApi: DesktopShellApi = {
  goBack: () => ipcRenderer.send("shell:back"),
  goForward: () => ipcRenderer.send("shell:forward"),
  reload: () => ipcRenderer.send("shell:reload"),
  toggleSidebar: () => ipcRenderer.send("shell:toggle-sidebar"),
  onNavigationStateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: NavigationState) => callback(state);
    ipcRenderer.on("shell:navigation-state", listener);
    return () => ipcRenderer.removeListener("shell:navigation-state", listener);
  },
  onSidebarStateChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: SidebarState) => callback(state);
    ipcRenderer.on("shell:sidebar-state", listener);
    return () => ipcRenderer.removeListener("shell:sidebar-state", listener);
  },
};

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.platform = process.platform;
});

contextBridge.exposeInMainWorld("desktopShell", desktopShellApi);
