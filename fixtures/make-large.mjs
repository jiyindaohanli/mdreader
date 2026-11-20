// Makes the two documents the size rules are tested with:
//   node fixtures/make-large.mjs
import { writeFileSync } from "node:fs";

const block = (n) => `## 第 ${n} 节

这是一段用来制造体积的正文，混合 **粗体**、*斜体*、\`行内代码\` 与 [链接](https://example.com)。

| 列 A | 列 B | 列 C |
| --- | :--: | --: |
| ${n} | 内容 | 123 |

\`\`\`go
func section${n}() int { return ${n} }
\`\`\`

- 列表项 ${n}
- 列表项 ${n}

> 引用 ${n}

`;

function make(path, megabytes) {
  const target = megabytes * 1024 * 1024;
  const parts = ["# 大文件测试\n\n"];
  let size = 0;
  let n = 0;
  while (size < target) {
    n += 1;
    const chunk = block(n);
    parts.push(chunk);
    size += Buffer.byteLength(chunk);
  }
  writeFileSync(path, parts.join(""));
  return size;
}

console.log("large-5mb.md:", make("fixtures/large-5mb.md", 5), "bytes");
console.log("huge-12mb.md:", make("fixtures/huge-12mb.md", 12), "bytes");
