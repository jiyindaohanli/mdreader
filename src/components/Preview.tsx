import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Rendered } from "../lib/markdown";
import { Files } from "../mygo";

export interface PreviewHandle {
  scrollRatio(): number;
  scrollToRatio(ratio: number): void;
  scrollToLine(line: number): void;
  topLine(): number;
}

interface Props {
  rendered: Rendered;
  docPath: string;
  theme: "light" | "dark";
  handle: Ref<PreviewHandle>;
  onScroll?(): void;
}

// Drawn diagrams are kept, so that scrolling back and forth costs nothing.
const mermaidCache = new Map<string, string>();
let diagramCount = 0;

export function Preview({ rendered, docPath, theme, handle, onScroll }: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const pane = inner.current;
    if (!pane) return;
    pane.innerHTML = rendered.html;
    pane.classList.remove("fade");
    void pane.offsetWidth;
    pane.classList.add("fade");

    // Images beside the document: the page cannot read the disk itself.
    if (docPath) {
      for (const img of pane.querySelectorAll<HTMLImageElement>("img[src]")) {
        const src = img.getAttribute("src") ?? "";
        if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith("//")) continue;
        Files.asset(docPath, decodeURI(src))
          .then((data) => {
            img.src = data;
          })
          .catch(() => {
            img.replaceWith(brokenImage(src));
          });
      }
    }

    // Mermaid: a card until the reader asks for the diagram.
    for (const block of pane.querySelectorAll<HTMLElement>(".mermaid-block")) {
      const code = block.querySelector("code")?.textContent ?? "";
      const button = block.querySelector<HTMLButtonElement>("[data-mermaid-render]");
      const cached = mermaidCache.get(cacheKey(code, theme));
      if (cached) {
        draw(block, cached);
        continue;
      }
      button?.addEventListener("click", async () => {
        if (!button || button.disabled) return;
        button.disabled = true;
        button.textContent = "渲染中…";
        try {
          const svg = await renderMermaid(code, theme);
          mermaidCache.set(cacheKey(code, theme), svg);
          draw(block, svg);
        } catch (err) {
          button.disabled = false;
          button.textContent = "重试";
          const body = block.querySelector(".mermaid-block__body");
          if (body) body.append(errorNote(err));
        }
      });
    }
  }, [rendered, docPath, theme]);

  // Links open in the system browser; anchors scroll the preview.
  useEffect(() => {
    const pane = scroll.current;
    if (!pane) return;
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest("a");
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        pane.querySelector(`#${CSS.escape(href.slice(1))}`)?.scrollIntoView({ block: "start" });
        return;
      }
      if (/^https?:/i.test(href)) void Files.openURL(href);
    };
    pane.addEventListener("click", onClick);
    return () => pane.removeEventListener("click", onClick);
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      scrollRatio: () => {
        const el = scroll.current;
        if (!el) return 0;
        const max = el.scrollHeight - el.clientHeight;
        return max > 0 ? el.scrollTop / max : 0;
      },
      scrollToRatio: (ratio) => {
        const el = scroll.current;
        if (!el) return;
        el.scrollTop = (el.scrollHeight - el.clientHeight) * ratio;
      },
      // Where the source line showing at the top of the pane starts.
      scrollToLine: (line) => {
        const el = scroll.current;
        const target = blockAt(inner.current, line);
        if (!el || !target) return;
        el.scrollTop = target.offsetTop - 8;
      },
      topLine: () => {
        const el = scroll.current;
        if (!el) return 1;
        const blocks = blockElements(inner.current);
        let line = 1;
        for (const block of blocks) {
          if (block.offsetTop - el.scrollTop <= 12) line = Number(block.dataset.line) || line;
          else break;
        }
        return line;
      },
    }),
    [handle],
  );

  return (
    <div className="preview" ref={scroll} onScroll={onScroll}>
      <div className="preview__inner" ref={inner} />
    </div>
  );
}

function blockElements(pane: HTMLElement | null): HTMLElement[] {
  if (!pane) return [];
  return [...pane.querySelectorAll<HTMLElement>("[data-line]")];
}

function blockAt(pane: HTMLElement | null, line: number): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const block of blockElements(pane)) {
    if ((Number(block.dataset.line) || 0) <= line) found = block;
    else break;
  }
  return found;
}

const cacheKey = (code: string, theme: string) => `${theme}\u0000${code}`;

function draw(block: HTMLElement, svg: string) {
  const body = block.querySelector(".mermaid-block__body");
  if (body) body.innerHTML = svg;
}

function brokenImage(src: string): HTMLElement {
  const note = document.createElement("div");
  note.className = "img-broken";
  note.textContent = `图片未找到：${src}`;
  return note;
}

function errorNote(err: unknown): HTMLElement {
  const note = document.createElement("p");
  note.className = "mermaid-block__error";
  note.textContent = `图表语法有误：${err instanceof Error ? err.message : String(err)}`;
  return note;
}

let mermaidTheme = "";

async function renderMermaid(code: string, theme: "light" | "dark"): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  if (mermaidTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "neutral",
      fontFamily: "inherit",
    });
    mermaidTheme = theme;
  }
  const { svg } = await mermaid.render(`mermaid-${++diagramCount}`, code);
  return svg;
}
