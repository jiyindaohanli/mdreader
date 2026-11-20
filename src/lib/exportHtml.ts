/**
 * Builds a single HTML file that keeps the document's looks: the app's CSS,
 * its fonts and every image inlined, so that the file opens offline anywhere.
 */
export async function buildExportHTML(title: string, bodyHTML: string, theme: "light" | "dark"): Promise<string> {
  const css = await inlinedStyles();
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
${css}
body { margin: 0; background: var(--bg); }
.export { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
@media print { body { background: #fff; } .export { padding: 0; } }
</style>
</head>
<body>
<main class="export preview">
<div class="preview__inner">${bodyHTML}</div>
</main>
</body>
</html>
`;
}

/** The stylesheets the page loaded, with every remote font folded in. */
async function inlinedStyles(): Promise<string> {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules ?? [])) chunks.push(rule.cssText);
  }
  let css = chunks.join("\n");
  const fonts = new Set(css.match(/url\((["']?)([^)"']+\.woff2)\1\)/g)?.map((match) => match) ?? []);
  for (const declaration of fonts) {
    const url = /url\((["']?)([^)"']+)\1\)/.exec(declaration)?.[2];
    if (!url) continue;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const buffer = new Uint8Array(await response.arrayBuffer());
      css = css.split(declaration).join(`url("data:font/woff2;base64,${toBase64(buffer)}")`);
    } catch {
      // a font that does not load stays a link: the rest of the file still works
    }
  }
  return css;
}

/** What the preview shows, with the parts that only work inside the app removed. */
export function exportableBody(pane: HTMLElement): string {
  const clone = pane.cloneNode(true) as HTMLElement;
  for (const button of clone.querySelectorAll("[data-mermaid-render]")) button.remove();
  for (const bar of clone.querySelectorAll(".mermaid-block__bar")) bar.remove();
  for (const error of clone.querySelectorAll(".mermaid-block__error")) error.remove();
  return clone.innerHTML;
}

function toBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function escapeHTML(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}
