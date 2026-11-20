import { describe, expect, it } from "vitest";
import { buildExportHTML, exportableBody } from "../src/lib/exportHtml";

describe("exportableBody", () => {
  it("drops the parts that only work inside the app", () => {
    const pane = document.createElement("div");
    pane.innerHTML = `
      <div class="mermaid-block">
        <div class="mermaid-block__bar"><span>Mermaid 图表</span><button type="button" data-mermaid-render>渲染</button></div>
        <div class="mermaid-block__body"><pre><code>graph LR</code></pre></div>
      </div>
      <p class="mermaid-block__error">渲染失败</p>
      <p>正文还在</p>`;
    const body = exportableBody(pane);

    expect(body).not.toContain("data-mermaid-render");
    expect(body).not.toContain("mermaid-block__bar");
    expect(body).not.toContain("mermaid-block__error");
    expect(body).toContain("graph LR");
    expect(body).toContain("正文还在");
    // The preview itself is untouched.
    expect(pane.querySelector("[data-mermaid-render]")).not.toBeNull();
  });
});

describe("buildExportHTML", () => {
  it("writes a standalone document that keeps the reader's theme", async () => {
    const html = await buildExportHTML("我的笔记 <草稿>", "<p>正文</p>", "dark");

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<title>我的笔记 &lt;草稿&gt;</title>');
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('<div class="preview__inner"><p>正文</p></div>');
    expect(html).toContain("<style>");
  });

  it("marks the file as printable", async () => {
    const html = await buildExportHTML("print", "<p>x</p>", "light");
    expect(html).toContain("@media print");
    expect(html).toContain('data-theme="light"');
  });
});
