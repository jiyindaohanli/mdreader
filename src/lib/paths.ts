// Windows paths come with either separator, and a regex literal with a
// backslash in it is easy to break in tooling, so the character is built once.
const BACKSLASH = String.fromCharCode(92);

export function toSlashes(path: string): string {
  return path.split(BACKSLASH).join("/");
}

export function baseName(path: string): string {
  const parts = toSlashes(path).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function folderName(path: string): string {
  const parts = toSlashes(path).split("/").filter(Boolean);
  return parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
}

export function looksLikePath(text: string): boolean {
  return text.includes("/") || text.includes(BACKSLASH);
}
