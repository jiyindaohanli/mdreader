import { renderMarkdownCore, type Rendered } from "./markdownCore";
import { sanitizeHTML } from "./sanitize";

export type { Rendered, TocItem } from "./markdownCore";

/**
 * Renders and sanitizes on the calling thread. The page uses the worker
 * (useRenderedMarkdown); this stays for tests and as the fallback when the
 * worker cannot start.
 */
export function renderMarkdown(source: string): Rendered {
  const result = renderMarkdownCore(source);
  return { ...result, html: sanitizeHTML(result.html) };
}
