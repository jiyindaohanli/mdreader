import { describe, expect, it } from "vitest";
import { baseName, folderName, looksLikePath, toSlashes } from "../src/lib/paths";

describe("paths", () => {
  it("reads Windows and POSIX separators alike", () => {
    expect(baseName("C:\\docs\\note.md")).toBe("note.md");
    expect(baseName("/home/me/note.md")).toBe("note.md");
    expect(baseName("note.md")).toBe("note.md");
    expect(toSlashes("C:\\docs\\sub\\a.md")).toBe("C:/docs/sub/a.md");
  });

  it("names the folder a document lives in", () => {
    expect(folderName("C:\\docs\\note.md")).toBe("docs");
    expect(folderName("/home/me/note.md")).toBe("me");
    expect(folderName("note.md")).toBe("");
  });

  it("tells a typed path from typed text", () => {
    expect(looksLikePath("C:\\docs\\note.md")).toBe(true);
    expect(looksLikePath("docs/note.md")).toBe(true);
    expect(looksLikePath("note.md")).toBe(false);
  });

  it("does not lose a path it cannot split", () => {
    expect(baseName("")).toBe("");
    expect(baseName("C:\\")).toBe("C:");
  });
});
