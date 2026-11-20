import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

const fixturePath = resolve(process.cwd(), "fixtures/all-features.md");
const raw = readFileSync(fixturePath, "utf8");
// What the page gets: Go's readDocument strips the BOM and normalizes CRLF.
const source = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const rendered = renderMarkdown(source);

describe("fixtures/all-features.md", () => {
  it("keeps the bytes the save test depends on (BOM + CRLF)", () => {
    expect(raw.startsWith("\uFEFF")).toBe(true);
    expect(raw).toContain("\r\n");
  });

  it("renders front matter as a card, not as body text", () => {
    expect(rendered.frontMatter).toContain("title: MDReader 全格式回归样例");
    expect(rendered.html).toContain('class="front-matter"');
    expect(rendered.html).toContain("Front Matter");
  });

  it("renders GFM: tables, task lists, strikethrough, autolinks", () => {
    expect(rendered.html).toContain("<table>");
    expect(rendered.html).toContain("<s>删除线</s>");
    expect(rendered.html).toContain("task-list-item");
    expect(rendered.html).toMatch(/<input[^>]*checked[^>]*type="checkbox"/);
    expect(rendered.html).toContain('href="https://mygo.run"');
  });

  it("builds the outline from h1–h3, with anchors and source lines", () => {
    expect(rendered.toc.length).toBeGreaterThanOrEqual(3);
    expect(rendered.toc[0]?.level).toBe(1);
    expect(rendered.toc[0]?.text).toContain("一级标题");
    for (const item of rendered.toc) {
      expect(item.level).toBeLessThanOrEqual(3);
      expect(item.id).not.toBe("");
      expect(item.line).toBeGreaterThan(0);
    }
    // h4–h6 are in the document but not in the outline.
    expect(rendered.toc.some((item) => item.text.includes("四级标题"))).toBe(false);
  });

  it("tags blocks with the line they start on, for scroll sync", () => {
    expect(rendered.html).toMatch(/data-line="\d+"/);
  });

  it("renders KaTeX for inline and display math", () => {
    expect(rendered.html).toContain("katex");
    expect(rendered.html).toContain("katex-display");
  });

  it("names all headings so links to sections work", () => {
    expect(rendered.html).toMatch(/<h1[^>]*id="/);
    expect(rendered.html).toMatch(/<h3[^>]*id="/);
  });

  it("highlights fenced code by language", () => {
    expect(rendered.html).toContain("hljs");
    expect(rendered.html).toMatch(/class="language-(ts|go|css|python|json)"/);
  });

  it("leaves Mermaid as a card that renders when clicked", () => {
    expect(rendered.html).toContain('class="mermaid-block"');
    expect(rendered.html).toContain("data-mermaid-render");
    expect(rendered.html).toContain("flowchart LR");
  });

  it("does not draw a diagram before the reader asks", () => {
    const only = renderMarkdown("```mermaid\ngraph LR\nA --> B\n```\n");
    expect(only.html).toContain("mermaid-block__source");
    expect(only.html).not.toContain("<svg");
  });

  it("keeps Mermaid source escaped", () => {
    const evil = renderMarkdown("```mermaid\nA --> B<C\n```\n");
    expect(evil.html).toContain("&lt;C");
    expect(evil.html).not.toContain("B<C");
  });

  it("strips the script, handlers and javascript: links", () => {
    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).not.toContain("onerror");
    expect(rendered.html).not.toContain("javascript:");
    expect(rendered.html).not.toContain("<iframe");
  });

  it("keeps harmless raw HTML and marks links safe", () => {
    expect(rendered.html).toContain("<kbd>Ctrl</kbd>");
    expect(rendered.html).toContain("<details>");
    expect(rendered.html).toContain('align="center"');
    expect(rendered.html).toMatch(/<a [^>]*rel="noreferrer noopener"/);
  });

  it("keeps relative images for the app to resolve beside the document", () => {
    expect(rendered.html).toContain('src="assets/sample.png"');
  });

  it("renders footnotes with their references", () => {
    expect(rendered.html).toContain("footnote");
    expect(rendered.html).toContain("第一个脚注的内容");
    expect(rendered.html).toContain("第二个脚注");
  });
});

describe("renderMarkdown", () => {
  it("does not leak front matter from one document into the next", () => {
    renderMarkdown("---\ntitle: 旧的\n---\n\n正文\n");
    const next = renderMarkdown("# 没有 front matter\n");
    expect(next.frontMatter).toBe("");
    expect(next.html).not.toContain("旧的");
  });

  it("escapes raw text instead of passing it through", () => {
    const { html } = renderMarkdown("```html\n<script>alert(1)</script>\n```\n");
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<script>");
  });
});
