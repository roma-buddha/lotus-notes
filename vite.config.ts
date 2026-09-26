import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  optimizeDeps: { entries: ["index.html"] },
  server: { watch: { ignored: ["**/src-tauri/target/**", "**/release/**"] } },
  build: { manifest: true },
});
