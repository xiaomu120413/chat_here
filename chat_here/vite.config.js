import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST || "0.0.0.0";

export default defineConfig({
  clearScreen: false,
  server: {
    host,
    port: 1421,
    strictPort: true,
    hmr: process.env.TAURI_DEV_HOST
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
});
