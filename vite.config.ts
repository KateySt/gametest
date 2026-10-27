import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 8080,
    open: true,
  },
  build: {
    // main.ts uses top-level await (await app.init / Assets.load).
    // Vite's default browser target predates it and fails the build.
    target: "es2022",
  },
});
