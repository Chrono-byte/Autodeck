import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

type StartServerModule = {
  default: {
    fetch(request: Request): Response | Promise<Response>;
  };
};

export type ProductionServer = {
  origin: string;
  close(): Promise<void>;
};

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStartServerModule(value: unknown): value is StartServerModule {
  if (!isRecord(value) || !isRecord(value.default)) return false;
  return typeof value.default.fetch === "function";
}

async function loadStartServer(buildDirectory: string): Promise<StartServerModule["default"]> {
  const serverEntry = resolve(buildDirectory, "server/server.js");
  const loadedModule: unknown = await import(pathToFileURL(serverEntry).href);
  if (!isStartServerModule(loadedModule)) {
    throw new Error(`The production server entry is invalid: ${serverEntry}`);
  }
  return loadedModule.default;
}

function appendRequestHeaders(target: Headers, source: IncomingHttpHeaders): void {
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) target.append(name, item);
    } else if (value !== undefined) {
      target.set(name, value);
    }
  }
}

async function readRequestBody(request: IncomingMessage): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Uint8Array.from(Buffer.concat(chunks)).buffer;
}

async function writeFetchResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;

  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") target.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) target.setHeader("set-cookie", cookies);

  if (!response.body) {
    target.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!target.write(Buffer.from(result.value))) {
        await new Promise<void>((resolveDrain) => target.once("drain", resolveDrain));
      }
    }
  } finally {
    reader.releaseLock();
  }
  target.end();
}

async function serveStaticFile(
  clientDirectory: string,
  pathname: string,
  response: ServerResponse,
): Promise<boolean> {
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!relativePath) return false;

  const filePath = resolve(clientDirectory, relativePath);
  const clientPrefix = clientDirectory.endsWith(sep) ? clientDirectory : `${clientDirectory}${sep}`;
  if (!filePath.startsWith(clientPrefix)) return false;

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) return false;

    response.statusCode = 200;
    response.setHeader("content-length", fileStats.size);
    response.setHeader(
      "content-type",
      contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    );
    response.setHeader(
      "cache-control",
      relativePath.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    );
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
  clientDirectory: string,
  startServer: StartServerModule["default"],
): Promise<void> {
  const url = new URL(request.url ?? "/", origin);
  if (await serveStaticFile(clientDirectory, url.pathname, response)) return;

  const headers = new Headers();
  appendRequestHeaders(headers, request.headers);
  const body = await readRequestBody(request);
  const fetchRequest = new Request(url, {
    body,
    headers,
    method: request.method ?? "GET",
  });
  await writeFetchResponse(await startServer.fetch(fetchRequest), response);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("The production server did not bind to a TCP port."));
        return;
      }
      resolveListen(address.port);
    });
  });
}

export async function startProductionServer(buildDirectory: string): Promise<ProductionServer> {
  const clientDirectory = resolve(buildDirectory, "client");
  const startServer = await loadStartServer(buildDirectory);
  let origin = "http://127.0.0.1";

  const server = createServer((request, response) => {
    void handleRequest(request, response, origin, clientDirectory, startServer).catch(
      (error: unknown) => {
        console.error("Desktop production server request failed", error);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader("content-type", "text/plain; charset=utf-8");
        }
        response.end("Internal Server Error");
      },
    );
  });

  const port = await listen(server);
  origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}
