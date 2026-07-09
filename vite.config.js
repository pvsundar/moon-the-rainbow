import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" makes the built site relocatable: it works at the root of any
// domain AND under a GitHub Pages project path (username.github.io/repo/).
export default defineConfig({
  plugins: [react()],
  base: "./",
});
