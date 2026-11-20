import DOMPurify from "dompurify";

// Links open in the system browser, images beside the document in the page.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("rel", "noreferrer noopener");
  }
});

/** Sanitizes the HTML the worker rendered; this is the only DOM-bound step. */
export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "align", "start", "checked", "disabled", "colspan", "rowspan"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "base"],
    FORBID_ATTR: ["srcset"],
  });
}
