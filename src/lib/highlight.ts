// The languages a Markdown document is likely to carry. Importing
// highlight.js/lib/common instead would bundle 37 of them.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  markdown,
  php,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

let registered = false;

export function highlightCode(code: string, language: string): string | null {
  if (!registered) {
    for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);
    hljs.registerAliases(["sh", "shell", "zsh", "console"], { languageName: "bash" });
    hljs.registerAliases(["js", "jsx", "mjs"], { languageName: "javascript" });
    hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
    hljs.registerAliases(["html", "svg", "xhtml"], { languageName: "xml" });
    hljs.registerAliases(["yml"], { languageName: "yaml" });
    hljs.registerAliases(["toml"], { languageName: "ini" });
    hljs.registerAliases(["golang"], { languageName: "go" });
    hljs.registerAliases(["py"], { languageName: "python" });
    hljs.registerAliases(["md"], { languageName: "markdown" });
    registered = true;
  }
  if (!language || !hljs.getLanguage(language)) return null;
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
