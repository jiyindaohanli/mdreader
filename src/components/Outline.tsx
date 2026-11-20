import type { TocItem } from "../lib/markdown";

interface Props {
  toc: TocItem[];
  activeId: string;
  onJump(id: string, line: number): void;
}

export function Outline({ toc, activeId, onJump }: Props) {
  return (
    <aside className="outline">
      <div className="outline__label">大纲</div>
      <div className="outline__list">
        {toc.length === 0 && <div className="outline__empty">没有标题</div>}
        {toc.map((item) => (
          <button
            key={`${item.id}-${item.line}`}
            type="button"
            className={`outline__item${item.id === activeId ? " outline__item--active" : ""}`}
            data-level={item.level}
            title={item.text}
            onClick={() => onJump(item.id, item.line)}
          >
            {item.text}
          </button>
        ))}
      </div>
    </aside>
  );
}
