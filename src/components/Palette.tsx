import { useEffect, useMemo, useRef, useState } from "react";
import { baseName, looksLikePath } from "../lib/paths";

export interface PaletteItem {
  key: string;
  label: string;
  detail?: string;
  run(): void;
}

interface Props {
  open: boolean;
  mode: "files" | "commands";
  items: PaletteItem[];
  onClose(): void;
  onOpenPath(path: string): void;
}

const PLACEHOLDER = {
  files: "搜索已打开的标签、最近文件，或粘贴路径后回车",
  commands: "搜索命令",
};

export function Palette({ open, mode, items, onClose, onOpenPath }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, mode]);

  const matches = useMemo(() => {
    const needle = query.trim();
    if (!needle) return items;
    const found = items.filter((item) =>
      `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(needle.toLowerCase()),
    );
    // A path pasted into the box opens, even when no recent file matches it.
    if (mode === "files" && found.length === 0 && looksLikePath(needle)) {
      return [
        { key: `path-${needle}`, label: baseName(needle), detail: "打开这个路径", run: () => onOpenPath(needle) },
      ];
    }
    return found;
  }, [items, query, mode, onOpenPath]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  if (!open) return null;

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="palette-backdrop" onPointerDown={onClose}>
      <div className="palette" onPointerDown={(event) => event.stopPropagation()}>
        <input
          ref={input}
          className="palette__input"
          placeholder={PLACEHOLDER[mode]}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(current + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(matches[index]);
            }
          }}
        />
        <div className="palette__list">
          {matches.length === 0 && <div className="palette__empty">没有匹配项</div>}
          {matches.map((item, position) => (
            <button
              key={item.key}
              type="button"
              className={`palette__item${position === index ? " palette__item--active" : ""}`}
              onPointerDown={(event) => {
                event.preventDefault();
                run(item);
              }}
              onPointerMove={() => setIndex(position)}
            >
              <span className="palette__label">{item.label}</span>
              {item.detail && <span className="palette__detail">{item.detail}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
