import { useCallback, useEffect, useRef, useState } from "react";
import type { Rendered } from "./markdownCore";
import { sanitizeHTML } from "./sanitize";

export interface PreviewRender {
  rendered: Rendered | null;
  /** The document id rendered, so a tab switch does not show the old tab's preview. */
  forId: string;
  pending: boolean;
  ms: number;
  error: string | null;
}

interface Request {
  id: number;
  source: string;
  identity: string;
  started: number;
}

/**
 * Renders Markdown in a worker, then sanitizes the HTML here: DOMPurify needs
 * a DOM. Parsing, highlighting and KaTeX no longer block typing; only the
 * sanitize step runs on this thread.
 */
export function useRenderedMarkdown(source: string, enabled: boolean, identity: string): PreviewRender {
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const request = useRef<Request>({ id: 0, source: "", identity: "", started: 0 });
  const [state, setState] = useState<PreviewRender>({
    rendered: null,
    forId: "",
    pending: false,
    ms: 0,
    error: null,
  });

  // The worker is usually there. If it cannot start (an old WebView2, a
  // blocked chunk), render on this thread instead of leaving a blank preview.
  const renderInMain = useCallback((id: number) => {
    const current = request.current;
    void import("./markdown")
      .then(({ renderMarkdown }) => {
        if (id !== latest.current) return;
        try {
          const rendered = renderMarkdown(current.source);
          setState({
            rendered,
            forId: current.identity,
            pending: false,
            ms: Math.round(performance.now() - current.started),
            error: null,
          });
        } catch (error) {
          setState({ rendered: null, forId: current.identity, pending: false, ms: 0, error: String(error) });
        }
      })
      .catch((error) => {
        if (id !== latest.current) return;
        setState({ rendered: null, forId: current.identity, pending: false, ms: 0, error: String(error) });
      });
  }, []);

  useEffect(() => {
    let instance: Worker | null = null;
    try {
      instance = new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<{ id: number; result?: Rendered; error?: string }>) => {
        const { id, result, error } = event.data;
        if (id !== latest.current) return;
        if (!result) {
          renderInMain(id);
          return;
        }
        try {
          const html = sanitizeHTML(result.html);
          const current = request.current;
          setState({
            rendered: { ...result, html },
            forId: current.identity,
            pending: false,
            ms: Math.round(performance.now() - current.started),
            error: null,
          });
        } catch (err) {
          setState({ rendered: null, forId: request.current.identity, pending: false, ms: 0, error: String(err) });
        }
      };
      instance.onerror = () => {
        worker.current = null;
        instance?.terminate();
        instance = null;
        renderInMain(latest.current);
      };
    } catch {
      worker.current = null;
    }
    return () => {
      instance?.terminate();
      worker.current = null;
    };
  }, [renderInMain]);

  useEffect(() => {
    if (!enabled) {
      setState({ rendered: null, forId: identity, pending: false, ms: 0, error: null });
      return;
    }
    const id = ++latest.current;
    request.current = { id, source, identity, started: performance.now() };
    setState((current) => ({ ...current, pending: true, error: null }));
    const instance = worker.current;
    if (instance) {
      instance.postMessage({ id, source });
      return;
    }
    renderInMain(id);
  }, [source, enabled, identity, renderInMain]);

  return state;
}
