import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const workspaceDirectory = resolve(import.meta.dirname, "../..");
process.env.AUTODEKT_RUNTIME_DIRECTORY ??= resolve(
  workspaceDirectory,
  ".codex-runtime/credentials",
);

export default defineConfig(({ command, mode }) => {
  const clientEnvironment = loadEnv(mode, workspaceDirectory, "");
  const backendEnvironment = loadEnv(mode, resolve(workspaceDirectory, "packages/backend"), "");

  process.env.VITE_CONVEX_URL ??=
    clientEnvironment.VITE_CONVEX_URL ?? backendEnvironment.CONVEX_URL;
  process.env.VITE_CONVEX_SITE_URL ??=
    clientEnvironment.VITE_CONVEX_SITE_URL ?? backendEnvironment.CONVEX_SITE_URL;

  return {
    envDir: workspaceDirectory,
    server: { port: 3000 },
    ssr: command === "build" ? { noExternal: true } : undefined,
    plugins: [tanstackStart(), tailwindcss(), react()],
  };
});
