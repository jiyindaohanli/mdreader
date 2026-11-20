import { useEffect, useRef, useState } from "react";
import type { Doc } from "../mygo";

interface Props {
  docs: Doc[];
  activeId: string | null;
  onActivate(id: string): void;
  onClose(id: string): void;
  onCloseOthers(id: string): void;
  onCloseRight(id: string): void;
  onNew(): void;
  onReorder(ids: string[]): void;
  onDetach(id: string, x: number, y: number): void;
  onDragOver(id: string, x: number, y: number): void;
  onDrop(id: string, x: number, y: number): void;
  onReveal(id: string): void;
}

interface Menu {
  id: string;
  x: number;
  y: number;
}

const DRAG_THRESHOLD = 6;

export function TabBar(props: Props) {
  const { docs, activeId } = props;
  const [order, setOrder] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean; asked: number } | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const ids = order ?? docs.map((doc) => doc.id);
  const byId = new Map(docs.map((doc) => [doc.id, doc]));

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  useEffect(() => {
    // A tab closed or opened elsewhere ends the local order.
    if (order && order.some((id) => !byId.has(id))) setOrder(null);
    if (order && order.length !== docs.length) setOrder(null);
  }, [docs, order, byId]);

  const startDrag = (event: React.PointerEvent, id: string) => {
    if (event.button === 1) {
      event.preventDefault();
      props.onClose(id);
      return;
    }
    if (event.button !== 0) return;
    props.onActivate(id);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // a pointer the window never saw as down: dragging still works without it
    }
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false, asked: 0 };
  };

  const moveDrag = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    if (!current.moved) {
      if (Math.abs(event.clientX - current.x) < DRAG_THRESHOLD && Math.abs(event.clientY - current.y) < DRAG_THRESHOLD) return;
      current.moved = true;
    }
    // Ask the Go side which window the pointer is over, a few times a second:
    // a tab dropped on another window joins its tabs.
    if (Date.now() - current.asked > 90) {
      current.asked = Date.now();
      props.onDragOver(current.id, Math.round(event.screenX), Math.round(event.screenY));
    }
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-tab-id]");
    const target = over?.dataset.tabId;
    if (!target || target === current.id) return;
    setOrder((previous) => {
      const list = [...(previous ?? docs.map((doc) => doc.id))];
      const from = list.indexOf(current.id);
      const to = list.indexOf(target);
      if (from < 0 || to < 0 || from === to) return previous ?? list;
      list.splice(from, 1);
      list.splice(to, 0, current.id);
      return list;
    });
  };

  const endDrag = (event: React.PointerEvent) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (!current.moved) {
      setOrder(null);
      return;
    }
    // The window the tab left keeps the order it showed; where the tab lands —
    // another window, a new one, or this one — is the Go side's to decide.
    if (order) props.onReorder(order);
    props.onDrop(current.id, Math.round(event.screenX), Math.round(event.screenY));
    setOrder(null);
  };

  const menuAction = (action: (id: string) => void) => {
    const id = menu?.id;
    setMenu(null);
    if (id) action(id);
  };

  return (
    <div className="tabbar">
      <div
        className="tabbar__tabs"
        ref={strip}
        onWheel={(event) => {
          const element = strip.current;
          if (!element || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
          element.scrollLeft += event.deltaY;
        }}
      >
        {ids.map((id) => {
          const doc = byId.get(id);
          if (!doc) return null;
          const active = id === activeId;
          return (
            <div
              key={id}
              data-tab-id={id}
              className={`tab${active ? " tab--active" : ""}`}
              title={doc.path}
              onPointerDown={(event) => startDrag(event, id)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ id, x: event.clientX, y: event.clientY });
              }}
            >
              {doc.dirty ? <span className="tab__dirty" /> : <span className="tab__file" />}
              <span className="tab__title">{doc.title}</span>
              <button
                className="tab__close"
                type="button"
                title="关闭 (Ctrl+W)"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(id);
                }}
              >
                <svg width="9" height="9" viewBox="0 0 8 8" aria-hidden="true">
                  <path d="M1.6 1.6 6.4 6.4M6.4 1.6 1.6 6.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          );
        })}
        <button className="tabbar__new" type="button" title="新建 (Ctrl+T)" onClick={props.onNew}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" onClick={() => menuAction(props.onClose)}>
            关闭标签
          </button>
          <button type="button" onClick={() => menuAction(props.onCloseOthers)}>
            关闭其他标签
          </button>
          <button type="button" onClick={() => menuAction(props.onCloseRight)}>
            关闭右侧标签
          </button>
          <div className="menu__separator" />
          <button type="button" onClick={() => menuAction(props.onReveal)}>
            在资源管理器中显示
          </button>
          <button
            type="button"
            onClick={() => {
              const doc = menu ? byId.get(menu.id) : null;
              setMenu(null);
              if (doc) void navigator.clipboard.writeText(doc.path);
            }}
          >
            复制文件路径
          </button>
          <div className="menu__separator" />
          <button
            type="button"
            onClick={() => {
              const doc = menu ? byId.get(menu.id) : null;
              setMenu(null);
              if (doc) props.onDrop(doc.id, 0, 0);
            }}
          >
            移动到新窗口
          </button>
        </div>
      )}
    </div>
  );
}
