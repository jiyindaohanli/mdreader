import { currentWindow } from "mygo-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, type EditorHandle } from "./components/Editor";
import { EmptyState } from "./components/EmptyState";
import { Outline } from "./components/Outline";
import { Palette, type PaletteItem } from "./components/Palette";
import { Preview, type PreviewHandle } from "./components/Preview";
import { StatusBar, type CursorInfo } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { TitleBar } from "./components/TitleBar";
import { buildExportHTML, exportableBody } from "./lib/exportHtml";
import { useRenderedMarkdown } from "./lib/useRenderedMarkdown";
import { baseName, folderName } from "./lib/paths";
import { useWorkspace } from "./lib/useWorkspace";
import { Workspace, type ShellStatus } from "./mygo";

type Mode = "read" | "split" | "edit";

const MODES: { id: Mode; label: string }[] = [
  { id: "read", label: "阅读" },
  { id: "split", label: "分栏" },
  { id: "edit", label: "编辑" },
];

const SYSTEM_THEME = "(prefers-color-scheme: dark)";
/* Above this the preview waits to be asked: rendering megabytes on every key
   press is what makes a Markdown editor feel broken. */
const HEAVY_BYTES = 1_000_000;
/* A 5 MB document renders into half a million elements and eats a gigabyte of
   memory: past this the preview stays off for good. */
const RENDER_LIMIT = 3_000_000;
/* Above this, a split view shows "正在渲染预览…" while the pause's render runs:
   it is still synchronous, but the freeze is explained instead of silent. */
const LARGE_PREVIEW = 200_000;
const READING_SIZES = [13, 14, 15, 16, 17, 18, 20, 22];

export default function App() {
  const ws = useWorkspace();
  const [mode, setMode] = useState<Mode>("read");
  const [ratio, setRatio] = useState(0.5);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(SYSTEM_THEME).matches);
  const [manualTheme, setManualTheme] = useState<"light" | "dark" | null>(null);
  const [readingSize, setReadingSize] = useState(15);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [palette, setPalette] = useState<null | "files" | "commands">(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [shell, setShell] = useState<ShellStatus | null>(null);
  const [closeToTray, setCloseToTray] = useState(true);
  const [startAtLogin, setStartAtLogin] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [topLine, setTopLine] = useState(1);
  const [cursor, setCursor] = useState<CursorInfo>({ line: 1, column: 1, selected: 0, lines: 1 });
  const [wrap, setWrap] = useState(() => window.localStorage.getItem("mdreader:wrap") !== "0");
  const [editorSize, setEditorSize] = useState(() => {
    const saved = Number(window.localStorage.getItem("mdreader:editor-size"));
    return Number.isFinite(saved) && saved >= 10 && saved <= 28 ? saved : 13.5;
  });
  const [overwrite, setOverwrite] = useState(false);
  const [previewSource, setPreviewSource] = useState(ws.buffer);
  const [heavyRequested, setHeavyRequested] = useState(false);

  const editor = useRef<EditorHandle>(null);
  const preview = useRef<PreviewHandle>(null);
  const syncing = useRef(0);
  const activeId = ws.active?.id ?? null;
  const latest = useRef(ws);
  latest.current = ws;

  const theme: "light" | "dark" = manualTheme ?? (systemDark ? "dark" : "light");
  const size = ws.active?.size ?? 0;
  const heavy = size > HEAVY_BYTES;
  const tooLarge = size > RENDER_LIMIT;
  // Rendering the whole document on every keystroke is what makes a long file
  // feel stuck. Render what was typed once the typing pauses; a document
  // switch or the read view renders at once.
  const previewDoc = useRef(activeId);
  useEffect(() => {
    const switched = previewDoc.current !== activeId;
    previewDoc.current = activeId;
    if (switched || mode === "read" || (heavy && !heavyRequested)) {
      setPreviewSource(ws.buffer);
      return;
    }
    const timer = setTimeout(() => setPreviewSource(ws.buffer), 120);
    return () => clearTimeout(timer);
  }, [ws.buffer, activeId, mode, heavy, heavyRequested]);

  // Parsing, highlighting and KaTeX run in a worker; only the sanitize step
  // touches this thread. The preview stays put while a new render is pending.
  const canRender = !tooLarge && (!heavy || heavyRequested);
  const previewRender = useRenderedMarkdown(previewSource, canRender, activeId ?? "");
  const shown = previewRender.forId === activeId ? previewRender.rendered : null;

  useEffect(() => {
    setHeavyRequested(false);
    if ((latest.current.active?.size ?? 0) > RENDER_LIMIT) setMode("edit");
  }, [activeId]);

  const renderNow = useCallback(() => {
    setHeavyRequested(true);
  }, []);

  const exportHtml = useCallback(async () => {
    const pane = document.querySelector<HTMLElement>(".preview__inner");
    const doc = latest.current.active;
    if (!pane || !doc) return;
    const html = await buildExportHTML(doc.title, exportableBody(pane), theme);
    await latest.current.exportHTML(html);
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia(SYSTEM_THEME);
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--reading-size", `${readingSize}px`);
  }, [readingSize]);

  useEffect(() => {
    const title = ws.active ? `${ws.active.title}${ws.active.dirty ? " •" : ""} — MDReader` : "MDReader";
    void currentWindow.setTitle(title);
  }, [ws.active]);

  // Whether this exe is in Explorer's "Open with" list and .md context menu.
  useEffect(() => {
    void Workspace.shellStatus()
      .then(setShell)
      .catch(() => setShell(null));
  }, []);

  // The tray can change "close to tray" too; the window picks it up when it
  // comes back to the foreground.
  useEffect(() => {
    const refresh = () => {
      void Workspace.settings()
        .then((next) => {
          setCloseToTray(next.closeToTray);
          setStartAtLogin(next.startAtLogin);
        })
        .catch(() => {});
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  // Where the reader was in the document that comes back.
  const remember = useCallback(() => {
    const id = latest.current.active?.id;
    if (!id) return;
    const info = editor.current?.cursorInfo();
    if (info) setCursor(info);
    latest.current.rememberView(id, editor.current?.cursor() ?? 0, preview.current?.scrollRatio() ?? 0);
  }, []);

  useEffect(() => {
    if (!activeId || !ws.loaded) return;
    const saved = ws.active ? { cursor: ws.active.cursor, scroll: ws.active.scroll } : { cursor: 0, scroll: 0 };
    const frame = requestAnimationFrame(() => {
      preview.current?.scrollToRatio(saved.scroll || 0);
      editor.current?.setCursor(saved.cursor);
      setTopLine(preview.current?.topLine() ?? 1);
      remember();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, ws.loaded, remember]);

  const toggleWrap = useCallback(() => {
    setWrap((on) => {
      const next = !on;
      window.localStorage.setItem("mdreader:wrap", next ? "1" : "0");
      return next;
    });
  }, []);

  const changeEditorSize = useCallback((size: number) => {
    setEditorSize(size);
    window.localStorage.setItem("mdreader:editor-size", String(size));
  }, []);

  // The editor and the preview follow each other in the split view.
  const syncFromEditor = useCallback(() => {
    const now = Date.now();
    if (now >= syncing.current && mode === "split") {
      syncing.current = now + 70;
      preview.current?.scrollToLine(editor.current?.topLine() ?? 1);
    }
    remember();
  }, [mode, remember]);

  const syncFromPreview = useCallback(() => {
    const line = preview.current?.topLine() ?? 1;
    setTopLine(line);
    const now = Date.now();
    if (now >= syncing.current && mode === "split") {
      syncing.current = now + 70;
      editor.current?.scrollToLine(line);
    }
    remember();
  }, [mode, remember]);

  const activeHeading = useMemo(() => {
    let id = "";
    for (const item of shown?.toc ?? []) if (item.line <= topLine) id = item.id;
    return id;
  }, [shown, topLine]);

  const jump = useCallback((id: string, line: number) => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
    // The editor follows the outline too, so the caret ends up where the
    // reader is looking.
    editor.current?.setCursorLine(line);
  }, []);

  const openPalette = useCallback((mode: "files" | "commands") => {
    setPalette(mode);
    if (mode === "files") void latest.current.recent().then(setRecent);
  }, []);

  // Adds the exe to Explorer's "Open with" and the .md context menu, or
  // takes it out again. The registration is per user, in HKCU.
  const toggleCloseToTray = useCallback(async () => {
    const next = !closeToTray;
    try {
      await Workspace.setCloseToTray(next);
      setCloseToTray(next);
    } catch (error) {
      setShellNotice(`设置失败：${String(error)}`);
    }
  }, [closeToTray]);

  const toggleStartAtLogin = useCallback(async () => {
    const next = !startAtLogin;
    try {
      await Workspace.setStartAtLogin(next);
      setStartAtLogin(next);
    } catch (error) {
      setShellNotice(`设置失败：${String(error)}`);
    }
  }, [startAtLogin]);

  const quit = useCallback(async () => {
    await ws.saveAll();
    await Workspace.quitApp();
  }, [ws.saveAll]);

  const toggleShell = useCallback(async () => {
    if (!shell?.supported) return;
    try {
      const next = shell.registered ? await Workspace.unregisterShell() : await Workspace.registerShell();
      setShell(next);
      setShellNotice(
        next.registered
          ? "已加入右键菜单：右键 .md → 打开方式 → MDReader；Windows 11 的「显示更多选项」里还有「用 MDReader 打开」"
          : "已取消右键菜单注册，下次启动也不会自动加回",
      );
    } catch (error) {
      setShellNotice(`右键菜单设置失败：${String(error)}`);
    }
  }, [shell]);

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = ws.docs.map((doc) => ({
      key: `tab-${doc.id}`,
      label: doc.title,
      detail: "已打开",
      run: () => ws.activate(doc.id),
    }));
    for (const path of recent) {
      if (ws.docs.some((doc) => doc.path === path)) continue;
      items.push({
        key: `recent-${path}`,
        label: baseName(path),
        detail: path,
        run: () => ws.open(path),
      });
    }
    return items;
  }, [ws, recent]);

  const commands = useMemo<PaletteItem[]>(() => {
    const setView = (next: Mode) => () => setMode(next);
    return [
      { key: "cmd-read", label: "视图：阅读", detail: "Ctrl+E 循环", run: setView("read") },
      { key: "cmd-split", label: "视图：分栏", run: setView("split") },
      { key: "cmd-edit", label: "视图：编辑", run: setView("edit") },
      { key: "cmd-outline", label: "切换大纲", detail: "Ctrl+Shift+O", run: () => setOutlineOpen((open) => !open) },
      {
        key: "cmd-theme",
        label: theme === "dark" ? "主题：切到浅色" : "主题：切到深色",
        detail: "Ctrl+Shift+D",
        run: () => setManualTheme(theme === "dark" ? "light" : "dark"),
      },
      { key: "cmd-open", label: "打开文件…", detail: "Ctrl+O", run: () => latest.current.openDialog() },
      { key: "cmd-new", label: "新建标签", detail: "Ctrl+T", run: () => latest.current.newTab() },
      { key: "cmd-save", label: "保存", detail: "Ctrl+S", run: () => void latest.current.save() },
      { key: "cmd-saveas", label: "另存为…", detail: "Ctrl+Shift+S", run: () => void latest.current.saveAs() },
      {
        key: "cmd-reveal",
        label: "在资源管理器中显示",
        run: () => {
          const doc = latest.current.active;
          if (doc) latest.current.reveal(doc.id);
        },
      },
      {
        key: "cmd-copy",
        label: "复制当前文件路径",
        run: () => {
          const doc = latest.current.active;
          if (doc) void navigator.clipboard.writeText(doc.path);
        },
      },
      { key: "cmd-default", label: "设为默认 .md 程序", run: () => latest.current.setDefaultApp() },
      {
        key: "cmd-tray",
        label: closeToTray ? "关闭时收进托盘：开" : "关闭时收进托盘：关",
        run: () => void toggleCloseToTray(),
      },
      {
        key: "cmd-login",
        label: startAtLogin ? "开机启动（隐藏到托盘）：开" : "开机启动（隐藏到托盘）：关",
        run: () => void toggleStartAtLogin(),
      },
      { key: "cmd-quit", label: "退出 MDReader", run: () => void quit() },
      {
        key: "cmd-shell",
        label: shell?.registered ? "取消右键打开（.md）" : "加入右键打开（.md）",
        run: () => void toggleShell(),
      },
      { key: "cmd-export", label: "导出为 HTML…", run: () => void exportHtml() },
      { key: "cmd-print", label: "打印 / 另存为 PDF", run: () => window.print() },
    ];
  }, [theme, exportHtml, shell, toggleShell, closeToTray, toggleCloseToTray, startAtLogin, toggleStartAtLogin, quit]);

  const cycleMode = useCallback(() => {
    setMode((current) => MODES[(MODES.findIndex((item) => item.id === current) + 1) % MODES.length]!.id);
  }, []);

  const stepSize = useCallback((delta: number) => {
    setReadingSize((size) => {
      const index = READING_SIZES.indexOf(size);
      const next = Math.min(READING_SIZES.length - 1, Math.max(0, (index < 0 ? 2 : index) + delta));
      return READING_SIZES[next]!;
    });
  }, []);

  const stepTab = useCallback((delta: number) => {
    const { docs } = latest.current;
    const id = latest.current.active?.id;
    if (!id || docs.length < 2) return;
    const index = docs.findIndex((doc) => doc.id === id);
    latest.current.activate(docs[(index + delta + docs.length) % docs.length]!.id);
  }, []);

  const goto = useCallback((index: number) => {
    const { docs } = latest.current;
    const doc = index < 0 ? docs[docs.length - 1] : docs[index];
    if (doc) latest.current.activate(doc.id);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Insert") {
        event.preventDefault();
        setOverwrite((on) => !on);
        return;
      }
      if (!event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "tab") {
        event.preventDefault();
        stepTab(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.shiftKey) {
        if (key === "p") {
          event.preventDefault();
          openPalette("commands");
          return;
        }
        if (key === "s") {
          event.preventDefault();
          void latest.current.saveAs();
          return;
        }
        if (key === "d") {
          event.preventDefault();
          setManualTheme(theme === "dark" ? "light" : "dark");
          return;
        }
        if (key === "o") {
          event.preventDefault();
          setOutlineOpen((open) => !open);
          return;
        }
      }
      if (/^[1-9]$/.test(key)) {
        event.preventDefault();
        goto(key === "9" ? -1 : Number(key) - 1);
        return;
      }
      switch (key) {
        case "o":
          event.preventDefault();
          latest.current.openDialog();
          return;
        case "s":
          event.preventDefault();
          void latest.current.save();
          return;
        case "t":
          event.preventDefault();
          latest.current.newTab();
          return;
        case "w":
          event.preventDefault();
          if (latest.current.active) latest.current.closeTab(latest.current.active.id);
          return;
        case "e":
          event.preventDefault();
          cycleMode();
          return;
        case "p":
          event.preventDefault();
          openPalette("files");
          return;
        case "=":
        case "+":
          event.preventDefault();
          stepSize(1);
          return;
        case "-":
          event.preventDefault();
          stepSize(-1);
          return;
        case "0":
          event.preventDefault();
          setReadingSize(15);
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycleMode, goto, openPalette, stepSize, stepTab, theme]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const panes = (event.currentTarget as HTMLElement).parentElement;
    if (!panes) return;
    const move = (moveEvent: MouseEvent) => {
      const box = panes.getBoundingClientRect();
      setRatio(Math.min(0.78, Math.max(0.22, (moveEvent.clientX - box.left) / box.width)));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }, []);

  const closeOthers = useCallback(
    (id: string) => {
      for (const doc of ws.docs) if (doc.id !== id) ws.closeTab(doc.id);
    },
    [ws],
  );

  const closeRight = useCallback(
    (id: string) => {
      const index = ws.docs.findIndex((doc) => doc.id === id);
      if (index < 0) return;
      for (const doc of ws.docs.slice(index + 1)) ws.closeTab(doc.id);
    },
    [ws],
  );

  const showOutline = outlineOpen && mode !== "edit" && (shown?.toc.length ?? 0) > 0;

  return (
    <div className="app">
      <TitleBar
        title={ws.active?.title ?? "MDReader"}
        folder={folderName(ws.active?.path ?? "")}
        path={ws.active?.path ?? ""}
        dirty={!!ws.active?.dirty}
      />
      <TabBar
        docs={ws.docs}
        activeId={activeId}
        onActivate={ws.activate}
        onClose={ws.closeTab}
        onCloseOthers={closeOthers}
        onCloseRight={closeRight}
        onNew={ws.newTab}
        onReorder={ws.reorder}
        onDetach={ws.detach}
        onDragOver={ws.dragOver}
        onDrop={ws.drop}
        onReveal={ws.reveal}
      />
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="视图">
          {MODES.map((item) => (
            <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <button className="icon-button" type="button" title="打开 (Ctrl+O)" onClick={ws.openDialog}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4l1.3 1.5h5.3A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="icon-button"
          type="button"
          title="保存 (Ctrl+S)"
          disabled={!ws.active?.dirty}
          onClick={() => void ws.save()}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3 2.5h7.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path d="M5.5 2.5h4v3h-4z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="icon-button"
          type="button"
          title="大纲 (Ctrl+Shift+O)"
          aria-pressed={outlineOpen}
          data-on={outlineOpen}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3 4h10M3 8h6M3 12h8"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="toolbar__spacer" />
        <span className="toolbar__hint">Ctrl+P 文件 · Ctrl+Shift+P 命令 · Ctrl+E 切视图</span>
        <button className="icon-button" type="button" title="快速打开 (Ctrl+P)" onClick={() => openPalette("files")}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="icon-button"
          type="button"
          title="切换深浅色 (Ctrl+Shift+D)"
          onClick={() => setManualTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        <div className="menu-anchor">
          <button className="icon-button" type="button" title="更多" onClick={() => setMenuOpen((open) => !open)}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1.1" fill="currentColor" />
              <circle cx="8" cy="8" r="1.1" fill="currentColor" />
              <circle cx="12.5" cy="8" r="1.1" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu menu--anchored">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void toggleShell();
                }}
              >
                {shell?.registered ? "取消右键打开（.md）" : "加入右键打开（.md）"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  ws.setDefaultApp();
                }}
              >
                设为默认 .md 程序
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void toggleCloseToTray();
                }}
              >
                <span className="menu__check">{closeToTray ? "✓" : ""}</span>
                关闭时收进托盘
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void toggleStartAtLogin();
                }}
              >
                <span className="menu__check">{startAtLogin ? "✓" : ""}</span>
                开机启动（隐藏到托盘）
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (ws.active) ws.reveal(ws.active.id);
                }}
              >
                在资源管理器中显示
              </button>
              <div className="menu__separator" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void ws.saveAs();
                }}
              >
                另存为… (Ctrl+Shift+S)
              </button>
              <button
                type="button"
                disabled={!shown}
                onClick={() => {
                  setMenuOpen(false);
                  void exportHtml();
                }}
              >
                导出为 HTML…
              </button>
              <button
                type="button"
                disabled={!shown}
                onClick={() => {
                  setMenuOpen(false);
                  window.print();
                }}
              >
                打印 / 另存为 PDF
              </button>
              <div className="menu__separator" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void quit();
                }}
              >
                退出 MDReader
              </button>
            </div>
          )}
        </div>
      </div>

      {ws.notice && (
        <NoticeBar
          notice={ws.notice}
          docs={ws.docs}
          onReload={ws.reload}
          onKeep={ws.keepDraft}
          onDismiss={ws.dismissNotice}
        />
      )}

      {shellNotice && (
        <div className="notice">
          <span>{shellNotice}</span>
          <button type="button" className="notice__dismiss" onClick={() => setShellNotice(null)}>
            ×
          </button>
        </div>
      )}

      {ws.active && ws.loaded ? (
        <div className="panes" data-mode={mode}>
          <div className="pane pane--editor" style={mode === "split" ? { width: `${ratio * 100}%` } : undefined}>
            <Editor
              docId={ws.active.id}
              docIds={ws.docs.map((doc) => doc.id)}
              value={ws.buffer}
              docPath={ws.active.path}
              theme={theme}
              wrap={wrap}
              overwrite={overwrite}
              fontSize={editorSize}
              handle={editor}
              onChange={(text) => {
                ws.edit(text);
                remember();
              }}
              onCursor={remember}
              onScroll={syncFromEditor}
            />
          </div>
          <div className="splitter" role="separator" aria-orientation="vertical" onMouseDown={startResize} />
          <div className="pane pane--preview">
            {shown ? (
              <Preview
                rendered={shown}
                docPath={ws.active.path}
                theme={theme}
                handle={preview}
                onScroll={syncFromPreview}
              />
            ) : previewRender.pending ? null : (
              <div className="preview">
                <div className="preview__inner">
                  <div className="heavy">
                    <p>
                      这个文件有 {((ws.active.size ?? 0) / 1048576).toFixed(1)} MB，
                      {tooLarge ? "预览渲染会占用上 GB 内存，所以不渲染，请用编辑模式查看。" : "实时预览会让输入变卡，所以默认关掉了。"}
                    </p>
                    {previewRender.error && <p className="heavy__done">预览渲染失败：{previewRender.error}</p>}
                    {tooLarge ? (
                      <button type="button" onClick={() => setMode("edit")}>
                        切到编辑模式
                      </button>
                    ) : (
                      <button type="button" onClick={renderNow}>
                        渲染预览
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {previewRender.pending && size > LARGE_PREVIEW && (
              <div className="preview__rendering">正在渲染预览…</div>
            )}
            {ws.dropTarget && <div className="dropzone">松开，标签会加入这个窗口</div>}
          </div>
          {showOutline && <Outline toc={shown?.toc ?? []} activeId={activeHeading} onJump={jump} />}
        </div>
      ) : (
        <div className="panes">
          <div className="pane pane--preview">
            <EmptyState loading={ws.docs.length > 0 || ws.state === null} />
          </div>
        </div>
      )}

      <StatusBar
        doc={ws.active}
        length={ws.buffer.length}
        cursor={cursor}
        wrap={wrap}
        overwrite={overwrite}
        fontSize={editorSize}
        onWrap={toggleWrap}
        onOverwrite={() => setOverwrite((on) => !on)}
        onFontSize={changeEditorSize}
        onFormat={(eol, encoding) => {
          if (ws.active) ws.setFormat(ws.active.id, eol, encoding);
        }}
      />

      <Palette
        open={palette !== null}
        mode={palette ?? "files"}
        items={palette === "commands" ? commands : paletteItems}
        onClose={() => setPalette(null)}
        onOpenPath={(path) => ws.open(path)}
      />
    </div>
  );
}

function NoticeBar(props: {
  notice: { id: string; kind: "external" | "error"; title: string; text: string };
  docs: { id: string; missing: boolean }[];
  onReload(id: string): void;
  onKeep(id: string): void;
  onDismiss(): void;
}) {
  const { notice } = props;
  const missing = notice.kind === "external" && props.docs.some((doc) => doc.id === notice.id && doc.missing);
  const text = missing ? "文件已被删除或移动，你的内容还在编辑器里" : notice.text;
  return (
    <div className="notice" data-kind={notice.kind}>
      <span>{notice.title ? `${notice.title}：${text}` : text}</span>
      {notice.kind === "external" && !missing && (
        <>
          <button type="button" onClick={() => props.onReload(notice.id)}>
            重新载入
          </button>
          <button type="button" onClick={() => props.onKeep(notice.id)}>
            保留我的
          </button>
        </>
      )}
      <button type="button" className="notice__dismiss" onClick={props.onDismiss}>
        ×
      </button>
    </div>
  );
}
