import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: {
    rollupOptions: {
      // Две страници: главната и галерията с картини
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        gallery: fileURLToPath(new URL("./gallery.html", import.meta.url)),
        game: fileURLToPath(new URL("./game.html", import.meta.url)),
      },
    },
  },
});