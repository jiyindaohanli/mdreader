import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "MDReader",
  identifier: "cn.evegood.mdreader",
  version: "0.1.0",
  copyright: "© 2026 fivenull",
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "npm run dev:web",
  buildCommand: "npm run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
  // Right-click > Open with, double-click, and the "New" item the installer
  // adds: the app opens the files of these types.
  windows: { installerInclude: "build/installer.nsh" },
  fileAssociations: [
    {
      ext: ["md", "markdown", "mdown"],
      name: "Markdown 文档",
      mimeType: "text/markdown",
    },
  ],
});
