import "./styles/inter.css";
import "./styles/katex-fonts.css";
import "./styles/katex.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";

if (import.meta.env.DEV) {
  // Handy while working on the export: the same functions the menu runs.
  void import("./lib/exportHtml").then((module) => {
    (window as unknown as Record<string, unknown>).__export = module;
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
