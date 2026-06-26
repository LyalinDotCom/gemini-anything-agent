import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const sdkAlias = resolve("src/sdk");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main"
    },
    resolve: {
      alias: {
        "@sdk": sdkAlias
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload"
    }
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    build: {
      outDir: "../../dist/renderer",
      emptyOutDir: true
    },
    resolve: {
      alias: {
        "@sdk": sdkAlias
      }
    }
  }
});
