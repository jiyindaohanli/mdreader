import { renderMarkdownCore } from "./markdownCore";

// A DedicatedWorkerGlobalScope, without pulling the webworker lib into the
// page's type-checking: the worker has no DOM, and the page never runs this.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; source: string }>) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event) => {
  const { id, source } = event.data;
  try {
    scope.postMessage({ id, result: renderMarkdownCore(source) });
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
