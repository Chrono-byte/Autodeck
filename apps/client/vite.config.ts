import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const workspaceDirectory = resolve(import.meta.dirname, "../..");
process.env.AUTODEKT_RUNTIME_DIRECTORY ??= resolve(workspaceDirectory, ".codex-runtime/app-server");

export default defineConfig(({ command, mode }) => {
  const clientEnvironment = loadEnv(mode, workspaceDirectory, "");
  const backendEnvironment = loadEnv(mode, resolve(workspaceDirectory, "packages/backend"), "");

  const convexUrl = clientEnvironment.VITE_CONVEX_URL ?? backendEnvironment.CONVEX_URL;
  const convexSiteUrl =
    clientEnvironment.VITE_CONVEX_SITE_URL ?? backendEnvironment.CONVEX_SITE_URL;
  if (!process.env.VITE_CONVEX_URL || process.env.VITE_CONVEX_URL === "undefined") {
    process.env.VITE_CONVEX_URL = convexUrl;
  }
  if (!process.env.VITE_CONVEX_SITE_URL || process.env.VITE_CONVEX_SITE_URL === "undefined") {
    process.env.VITE_CONVEX_SITE_URL = convexSiteUrl;
  }
  const backendConfigured = Boolean(
    process.env.VITE_CONVEX_URL && process.env.VITE_CONVEX_SITE_URL,
  );

  return {
    envDir: workspaceDirectory,
    server: { port: 3000, strictPort: true },
    ssr: command === "build" ? { noExternal: true } : undefined,
    plugins: [
      {
        name: "autodekt-development-health",
        configureServer(server) {
          server.middlewares.use("/autodekt-health.json", (_request, response) => {
            response.setHeader("Content-Type", "application/json");
            response.end(
              JSON.stringify({
                application: "autodekt",
                configured: backendConfigured,
              }),
            );
          });
        },
      },
      tanstackStart(),
      tailwindcss(),
      react(),
    ],
  };
});
