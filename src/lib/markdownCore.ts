import katex from "@vscode/markdown-it-katex";
import MarkdownIt, { type Token } from "markdown-it";
import { highlightCode } from "./highlight";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import frontMatter from "markdown-it-front-matter";
import taskLists from "markdown-it-task-lists";

export interface TocItem {
  level: number;
  text: string;
  id: string;
  line: number;
}

export interface Rendered {
  html: string;
  toc: TocItem[];
  frontMatter: string;
}

const slugify = (text: string) => encodeURIComponent(text.trim().toLowerCase().replace(/\s+/g, "-"));

function highlight(code: string, lang: string): string {
  const value = highlightCode(code, lang);
  if (value !== null) {
    return `<pre class="hljs"><code class="language-${lang}">${value}</code></pre>`;
  }
  return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight,
});

// Front matter is drawn as a card of its own above the document.
let capturedFrontMatter = "";
md.use(frontMatter, (raw: string) => {
  capturedFrontMatter = raw;
});
md.use(footnote);
md.use(taskLists, { label: true });
// The KaTeX plugin is CommonJS wrapped twice: Vite hands back { default: fn }.
const katexPlugin = (
  typeof katex === "function" ? katex : (katex as unknown as { default: typeof katex }).default
) as unknown as Parameters<InstanceType<typeof MarkdownIt>["use"]>[0];
md.use(katexPlugin, { throwOnError: false });
md.use(anchor, { slugify, tabIndex: false });

// Mermaid is drawn when the reader asks for it: the parser only leaves a card.
const fence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const info = tokens[idx]!.info.trim().split(/\s+/)[0] ?? "";
  if (info === "mermaid") {
    const code = md.utils.escapeHtml(tokens[idx]!.content);
    return `<div class="mermaid-block"><div class="mermaid-block__bar"><span>Mermaid 图表</span><button type="button" data-mermaid-render>渲染</button></div><div class="mermaid-block__body"><pre class="mermaid-block__source"><code>${code}</code></pre></div></div>`;
  }
  return fence(tokens, idx, options, env, self);
};

// Every block carries the line it starts on, so that the editor and the preview
// can scroll to the same place.
md.core.ruler.push("source-line", (state) => {
  for (const token of state.tokens) {
    if (!token.map || token.nesting === -1) continue;
    switch (token.type) {
      case "paragraph_open":
      case "heading_open":
      case "blockquote_open":
      case "bullet_list_open":
      case "ordered_list_open":
      case "list_item_open":
      case "table_open":
      case "fence":
      case "code_block":
      case "hr":
      case "html_block":
        token.attrSet("data-line", String(token.map[0] + 1));
        break;
    }
  }
});

/**
 * Parses Markdown to the preview's HTML, without sanitizing: DOMPurify needs a
 * DOM, so it runs in the page. This module has no DOM dependency and is what
 * the worker imports.
 */
export function renderMarkdownCore(source: string): Rendered {
  capturedFrontMatter = "";
  const tokens = md.parse(source, {});
  const toc: TocItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type !== "heading_open" || token.tag === "h4" || token.tag === "h5" || token.tag === "h6") continue;
    const id = String(token.attrGet("id") ?? "");
    const text = plainText(tokens[i + 1]);
    const line = Number(String(token.attrGet("data-line") ?? "0")) || 1;
    if (text) toc.push({ level: Number(token.tag.slice(1)), text, id, line });
  }
  const html = md.renderer.render(tokens, md.options, {});
  const front = capturedFrontMatter.trim();
  const card = front
    ? `<div class="front-matter"><div class="front-matter__label">Front Matter</div><pre><code>${md.utils.escapeHtml(front)}</code></pre></div>`
    : "";
  return { html: card + html, toc, frontMatter: front };
}

function plainText(token: Token | undefined): string {
  if (!token) return "";
  if (token.type === "inline" && token.children) return token.children.map((child: Token) => child.content).join("");
  return token.content;
}
