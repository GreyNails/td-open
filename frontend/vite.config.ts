import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    proxy: { "/api": { target: "http://127.0.0.1:8765", changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "three/examples/jsm/loaders/GLTFLoader.js"],
          flow: ["@xyflow/react"],
        },
      },
    },
  },
});
