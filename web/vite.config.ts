import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    host: true,
    strictPort: false,
    // The agent payload is ?raw-imported from the repo-root agents/ folder (shared
    // with the Electron app), which sits outside this Vite root.
    fs: { allow: [".", ".."] },
  },
});
