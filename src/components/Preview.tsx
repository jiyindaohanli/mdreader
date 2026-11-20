import morphdom from "morphdom";
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
  const lastDocPath = useRef("");

  useEffect(() => {
    const pane = inner.current;
    if (!pane) return;
    const top = scroll.current?.scrollTop ?? 0;
    const docChanged = lastDocPath.current !== docPath;
    lastDocPath.current = docPath;

    // Patch the new HTML into the old tree instead of replacing it: a full
    // innerHTML reset jumped the scroll and threw away rendered diagrams and
    // loaded images on every keystroke.
    const template = document.createElement("div");
    template.innerHTML = rendered.html;
    morphdom(pane, template, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl.classList.contains("mermaid-block")) {
          const code = toEl.querySelector(".mermaid-block__source code")?.textContent ?? "";
          if (fromEl.dataset.mermaidKey === cacheKey(code, theme)) return false;
          delete fromEl.dataset.mermaidKey;
        }
        if (fromEl.tagName === "IMG" && !docChanged) {
          const img = fromEl as HTMLImageElement;
          const original = img.dataset.originalSrc;
          if (original && img.src.startsWith("data:") && toEl.getAttribute("src") === original) return false;
        }
        return true;
      },
    });
    if (scroll.current) scroll.current.scrollTop = top;

    // Images beside the document: the page cannot read the disk itself.
    if (docPath) {
      for (const img of pane.querySelectorAll<HTMLImageElement>("img[src]")) {
        const src = img.getAttribute("src") ?? "";
        if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith("//")) continue;
        if (img.dataset.assetState === "loading") continue;
        if (!docChanged && img.dataset.assetState === "done" && img.src.startsWith("data:")) continue;
        img.dataset.originalSrc = src;
        img.dataset.assetState = "loading";
        Files.asset(docPath, decodeURI(src))
          .then((data) => {
            img.src = data;
            img.dataset.assetState = "done";
          })
          .catch(() => {
            img.dataset.assetState = "failed";
            img.replaceWith(brokenImage(src));
          });
      }
    }

    // Diagrams already drawn for this source and theme stay as they are.
    for (const block of pane.querySelectorAll<HTMLElement>(".mermaid-block")) {
      if (block.dataset.mermaidKey) continue;
      const code = block.querySelector(".mermaid-block__source code")?.textContent ?? "";
      const key = cacheKey(code, theme);
      const cached = mermaidCache.get(key);
      if (cached) draw(block, cached, key);
    }
  }, [rendered, docPath, theme]);

  // One listener for every diagram button: morphdom keeps the elements, so
  // per-button listeners would accumulate and capture stale source.
  useEffect(() => {
    const pane = inner.current;
    if (!pane) return;
    const onClick = async (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("[data-mermaid-render]");
      if (!button || button.disabled) return;
      const block = button.closest<HTMLElement>(".mermaid-block");
      if (!block) return;
      const code = block.querySelector(".mermaid-block__source code")?.textContent ?? "";
      const key = cacheKey(code, theme);
      button.disabled = true;
      button.textContent = "渲染中…";
      try {
        const svg = await renderMermaid(code, theme);
        mermaidCache.set(key, svg);
        draw(block, svg, key);
      } catch (err) {
        button.disabled = false;
        button.textContent = "重试";
        const body = block.querySelector(".mermaid-block__body");
        if (body) body.append(errorNote(err));
      }
    };
    pane.addEventListener("click", onClick);
    return () => pane.removeEventListener("click", onClick);
  }, [theme]);

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

function draw(block: HTMLElement, svg: string, key: string) {
  const body = block.querySelector(".mermaid-block__body");
  if (body) body.innerHTML = svg;
  block.dataset.mermaidKey = key;
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
