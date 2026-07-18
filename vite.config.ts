import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig(({ command }) => ({
  server: { port: 3000 },
  ssr: command === "build" ? { noExternal: true } : undefined,
  plugins: [tanstackStart(), tailwindcss(), react()],
}));
