import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const RUNTIME_DIRECTORY = process.env.AUTODEKT_RUNTIME_DIRECTORY
  ? resolve(process.env.AUTODEKT_RUNTIME_DIRECTORY)
  : resolve(process.cwd(), ".codex-runtime", "app-server");
const CODEX_EXECUTABLE = process.env.CODEX_EXECUTABLE?.trim() || "codex";

type JsonObject = Record<string, unknown>;
type RpcId = number;

type RpcResponse = {
  id: RpcId;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type RpcMessage =
  | RpcResponse
  | { id: RpcId; method: string; params?: unknown }
  | { method: string; params?: unknown };

export type CodexNotification = { method: string; params?: unknown };
export type CodexServerRequest = { id: RpcId; method: string; params?: unknown };
export type CodexServerRequestHandler = (request: CodexServerRequest) => Promise<unknown> | unknown;

export type OpenAICodexAuthEvent = {
  type: "device_code";
  userCode: string;
  verificationUri: string;
};

export interface OpenAICodexLoginInteraction {
  signal?: AbortSignal;
  notify: (event: OpenAICodexAuthEvent) => void;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcMessage(value: unknown): RpcMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id === "number" && typeof value.method === "string") {
    return { id: value.id, method: value.method, params: value.params };
  }
  if (typeof value.id === "number") {
    const error = isRecord(value.error)
      ? {
          code: typeof value.error.code === "number" ? value.error.code : undefined,
          message: typeof value.error.message === "string" ? value.error.message : undefined,
        }
      : undefined;
    return { id: value.id, result: value.result, error };
  }
  if (typeof value.method === "string") {
    return { method: value.method, params: value.params };
  }
  return undefined;
}

function ownerDirectory(ownerId: string) {
  return resolve(RUNTIME_DIRECTORY, createHash("sha256").update(ownerId).digest("hex"));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private startPromise: Promise<void> | undefined;
  private readonly pending = new Map<
    RpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly notificationListeners = new Set<(notification: CodexNotification) => void>();
  private readonly serverRequestHandlers = new Map<string, CodexServerRequestHandler>();

  constructor(private readonly directory: string) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    await this.start();
    const id = this.nextId++;
    const result = new Promise<unknown>((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
    });
    this.send({ id, method, ...(params !== undefined && { params }) });
    return result;
  }

  subscribe(listener: (notification: CodexNotification) => void) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  handleServerRequests(key: string, handler: CodexServerRequestHandler) {
    this.serverRequestHandlers.set(key, handler);
    return () => {
      if (this.serverRequestHandlers.get(key) === handler) this.serverRequestHandlers.delete(key);
    };
  }

  private async start() {
    this.startPromise ??= this.spawnAndInitialize();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = undefined;
      throw error;
    }
  }

  private async spawnAndInitialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const child = spawn(CODEX_EXECUTABLE, ["app-server", "--stdio"], {
      cwd: process.cwd(),
      env: { ...process.env, CODEX_HOME: this.directory },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => {
      this.fail(
        new Error(
          `Codex app-server exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`,
        ),
      );
    });
    createInterface({ input: child.stdout }).on("line", (line) => this.receive(line));
    // Drain stderr so a verbose child cannot block. Protocol data is intentionally never logged.
    child.stderr.resume();

    await this.requestWithoutStart("initialize", {
      clientInfo: { name: "autodekt", title: "Autodekt", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.send({ method: "initialized" });
  }

  private requestWithoutStart(method: string, params?: unknown) {
    const id = this.nextId++;
    const result = new Promise<unknown>((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
    });
    this.send({ id, method, ...(params !== undefined && { params }) });
    return result;
  }

  private send(message: JsonObject) {
    const child = this.process;
    if (!child?.stdin.writable) throw new Error("Codex app-server is not available.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return;
    }
    const message = rpcMessage(parsed);
    if (!message) return;

    if ("id" in message && !("method" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || `Codex RPC error ${message.error.code}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ("id" in message) {
      void this.answerServerRequest(message);
      return;
    }

    for (const listener of this.notificationListeners) listener(message);
  }

  private async answerServerRequest(request: CodexServerRequest) {
    const params = isRecord(request.params) ? request.params : {};
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const handler = this.serverRequestHandlers.get(threadId);
    try {
      if (!handler) throw new Error(`Unsupported Codex server request: ${request.method}`);
      const result = await handler(request);
      this.send({ id: request.id, result });
    } catch (error) {
      this.send({
        id: request.id,
        error: { code: -32_000, message: errorMessage(error) },
      });
    }
  }

  private fail(cause: unknown) {
    this.process = undefined;
    this.startPromise = undefined;
    const error = cause instanceof Error ? cause : new Error(errorMessage(cause));
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

const clients = new Map<string, CodexAppServerClient>();

export function codexAppServerFor(ownerId: string) {
  const existing = clients.get(ownerId);
  if (existing) return existing;
  const client = new CodexAppServerClient(ownerDirectory(ownerId));
  clients.set(ownerId, client);
  return client;
}

export async function getOpenAICodexStatus(ownerId: string) {
  const client = codexAppServerFor(ownerId);
  const [accountResult, modelResult] = await Promise.all([
    client.request("account/read", { refreshToken: true }),
    client.request("model/list", { limit: 100 }),
  ]);
  const account = isRecord(accountResult) ? accountResult.account : null;
  const models = isRecord(modelResult) && Array.isArray(modelResult.data) ? modelResult.data : [];
  return {
    connected: isRecord(account) && account.type === "chatgpt",
    models: models.flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== "string") return [];
      return [
        {
          id: value.id,
          name: typeof value.displayName === "string" ? value.displayName : value.id,
        },
      ];
    }),
  };
}

export async function loginOpenAICodex(ownerId: string, interaction: OpenAICodexLoginInteraction) {
  const client = codexAppServerFor(ownerId);
  const result = await client.request("account/login/start", { type: "chatgptDeviceCode" });
  if (!isRecord(result) || result.type !== "chatgptDeviceCode") {
    throw new Error("Codex app-server did not start device-code login.");
  }
  const loginId = typeof result.loginId === "string" ? result.loginId : "";
  const userCode = typeof result.userCode === "string" ? result.userCode : "";
  const verificationUri = typeof result.verificationUrl === "string" ? result.verificationUrl : "";
  if (!loginId || !userCode || !verificationUri) {
    throw new Error("Codex app-server returned an incomplete device-code login.");
  }
  interaction.notify({ type: "device_code", userCode, verificationUri });

  await new Promise<void>((resolveLogin, rejectLogin) => {
    const unsubscribe = client.subscribe((notification) => {
      if (notification.method !== "account/login/completed" || !isRecord(notification.params)) {
        return;
      }
      if (notification.params.loginId !== loginId) return;
      unsubscribe();
      interaction.signal?.removeEventListener("abort", abort);
      if (notification.params.success === true) resolveLogin();
      else
        rejectLogin(new Error(String(notification.params.error || "OpenAI Codex login failed.")));
    });
    const abort = () => {
      unsubscribe();
      void client.request("account/login/cancel", { loginId }).catch(() => undefined);
      rejectLogin(interaction.signal?.reason ?? new Error("OpenAI Codex login was cancelled."));
    };
    interaction.signal?.addEventListener("abort", abort, { once: true });
    if (interaction.signal?.aborted) abort();
  });
}

export async function logoutOpenAICodex(ownerId: string) {
  await codexAppServerFor(ownerId).request("account/logout");
}

export async function hasOpenAICodexConnection(ownerId: string) {
  const result = await codexAppServerFor(ownerId).request("account/read", { refreshToken: true });
  const account = isRecord(result) ? result.account : null;
  return isRecord(account) && account.type === "chatgpt";
}

export { isRecord };
