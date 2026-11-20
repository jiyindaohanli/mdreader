import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from "react";
import { Workspace } from "../mygo";

export interface EditorHandle {
  scrollRatio(): number;
  scrollToRatio(ratio: number): void;
  scrollToLine(line: number): void;
  topLine(): number;
  cursor(): number;
  setCursor(position: number): void;
  setCursorLine(line: number): void;
  focus(): void;
  /** Where the caret is, and how much is selected, for the status bar. */
  cursorInfo(): { line: number; column: number; selected: number; lines: number };
}

interface Props {
  docId: string;
  docIds: string[];
  value: string;
  docPath: string;
  onChange(value: string): void;
  onCursor?(): void;
  onScroll?(): void;
  theme: "light" | "dark";
  wrap: boolean;
  overwrite: boolean;
  fontSize: number;
  handle: Ref<EditorHandle>;
}

function highlightStyle(theme: "light" | "dark"): HighlightStyle {
  const dark = theme === "dark";
  const marks = dark ? "#6e6e76" : "#b4b4bc";
  return HighlightStyle.define([
    { tag: tags.heading, color: dark ? "#4aa3ff" : "#0f68a0", fontWeight: "600" },
    { tag: tags.strong, color: dark ? "#f2f2f7" : "#1c1c1e", fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through", color: dark ? "#6e6e76" : "#9a9aa0" },
    { tag: [tags.link, tags.url], color: dark ? "#4aa3ff" : "#007aff" },
    { tag: [tags.monospace, tags.string], color: dark ? "#fc6a5d" : "#c41a16" },
    { tag: tags.quote, color: dark ? "#98989f" : "#6e6e73", fontStyle: "italic" },
    { tag: tags.meta, color: dark ? "#6e6e76" : "#9a9aa0" },
    { tag: tags.contentSeparator, color: marks },
    { tag: tags.list, color: dark ? "#ff9f0a" : "#c93400" },
    { tag: [tags.processingInstruction, tags.punctuation], color: marks },
    { tag: tags.keyword, color: dark ? "#ff7ab2" : "#ad3da4" },
    { tag: tags.comment, color: marks, fontStyle: "italic" },
    { tag: tags.number, color: dark ? "#d0bf69" : "#1c00cf" },
    { tag: tags.function(tags.variableName), color: dark ? "#67b7a4" : "#0f68a0" },
  ]);
}

const themeConfig = new Compartment();
const wrapConfig = new Compartment();

// The search panel is CodeMirror's: these are its labels in Chinese.
const PHRASES = EditorState.phrases.of({
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  "by word": "整词",
  regexp: "正则",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
  "current match": "当前",
  "on line": "行",
  "replaced match on line $": "已替换第 $ 行",
  "replaced $ matches": "已替换 $ 处",
});

export function Editor({ docId, docIds, value, docPath, onChange, onCursor, onScroll, theme, wrap, overwrite, fontSize, handle }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const overwriteMode = useRef(overwrite);
  overwriteMode.current = overwrite;
  const emit = useRef(onChange);
  emit.current = onChange;
  const cursorMoved = useRef(onCursor);
  cursorMoved.current = onCursor;
  const scrolled = useRef(onScroll);
  scrolled.current = onScroll;
  const path = useRef(docPath);
  path.current = docPath;

  const extensions = useMemo(
    () => [
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      lineNumbers(),
      highlightSelectionMatches(),
      search({ top: true }),
      wrapConfig.of(wrap ? EditorView.lineWrapping : []),
      indentUnit.of("  "),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      PHRASES,
      themeConfig.of([syntaxHighlighting(highlightStyle(theme))]),
      EditorView.domEventHandlers({
        paste: (event, instance) => {
          const files = imageFiles(event.clipboardData);
          if (!files.length) return false;
          event.preventDefault();
          void insertImages(instance, files, path.current);
          return true;
        },
        drop: (event, instance) => {
          const files = imageFiles(event.dataTransfer);
          if (!files.length) return false;
          event.preventDefault();
          void insertImages(instance, files, path.current);
          return true;
        },
      }),
      // Overwrite mode replaces the character after the caret, as Notepad++
      // does. Only plain ASCII typing is intercepted: an IME composition
      // and a paste must insert normally.
      EditorView.inputHandler.of((instance, from, to, text) => {
        if (!overwriteMode.current || from !== to || text.length !== 1) return false;
        const code = text.charCodeAt(0);
        if (code < 0x20 || code > 0x7e) return false;
        const line = instance.state.doc.lineAt(from);
        if (from >= line.to) return false;
        const behind = line.text.charCodeAt(from - line.from);
        if (behind >= 0xd800 && behind <= 0xdfff) return false;
        instance.dispatch({
          changes: { from, to: from + 1, insert: text },
          selection: { anchor: from + 1 },
          scrollIntoView: true,
        });
        return true;
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) emit.current(update.state.doc.toString());
        if (update.selectionSet) cursorMoved.current?.();
      }),
    ],
    // The theme and wrap start here and are reconfigured by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const makeState = useCallback(
    (text: string) => EditorState.create({ doc: text, extensions }),
    [extensions],
  );

  // Each tab keeps its own EditorState: undo history, selection and folded
  // ranges survive switching, and the view is not rebuilt per tab.
  const states = useRef(new Map<string, EditorState>());
  const activeDoc = useRef(docId);

  useEffect(() => {
    const state = makeState(value);
    states.current.set(docId, state);
    const instance = new EditorView({ state, parent: host.current! });
    view.current = instance;
    const onScrollEvent = () => scrolled.current?.();
    instance.scrollDOM.addEventListener("scroll", onScrollEvent, { passive: true });
    return () => {
      instance.scrollDOM.removeEventListener("scroll", onScrollEvent);
      instance.destroy();
      view.current = null;
    };
    // The view is created once; documents are swapped into it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    if (docId === activeDoc.current) {
      // Text changed outside the editor, e.g. the file was reloaded.
      if (instance.state.doc.toString() !== value) {
        instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
      }
      return;
    }
    states.current.set(activeDoc.current, instance.state);
    activeDoc.current = docId;
    const existing = states.current.get(docId);
    const next = existing ?? makeState(value);
    if (!existing) states.current.set(docId, next);
    instance.setState(next);
    if (next.doc.toString() !== value) {
      instance.dispatch({ changes: { from: 0, to: instance.state.doc.length, insert: value } });
    }
    instance.dispatch({
      effects: EditorView.scrollIntoView(instance.state.selection.main.head, { y: "nearest" }),
    });
  }, [docId, value, makeState]);

  // A closed tab's state goes with it.
  useEffect(() => {
    const open = new Set(docIds);
    for (const id of [...states.current.keys()]) {
      if (!open.has(id)) states.current.delete(id);
    }
  }, [docIds]);

  useEffect(() => {
    view.current?.dispatch({
      effects: themeConfig.reconfigure([syntaxHighlighting(highlightStyle(theme))]),
    });
  }, [theme]);

  useEffect(() => {
    view.current?.dispatch({
      effects: wrapConfig.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  useImperativeHandle(
    handle,
    () => ({
      scrollRatio: () => {
        const el = view.current?.scrollDOM;
        if (!el) return 0;
        const max = el.scrollHeight - el.clientHeight;
        return max > 0 ? el.scrollTop / max : 0;
      },
      scrollToRatio: (ratio) => {
        const el = view.current?.scrollDOM;
        if (!el) return;
        el.scrollTop = (el.scrollHeight - el.clientHeight) * ratio;
      },
      topLine: () => {
        const instance = view.current;
        if (!instance) return 1;
        const block = instance.lineBlockAtHeight(instance.scrollDOM.scrollTop);
        return instance.state.doc.lineAt(block.from).number;
      },
      scrollToLine: (line) => {
        const instance = view.current;
        if (!instance) return;
        const number = Math.max(1, Math.min(line, instance.state.doc.lines));
        instance.scrollDOM.scrollTop = instance.lineBlockAt(instance.state.doc.line(number).from).top;
      },
      cursor: () => view.current?.state.selection.main.head ?? 0,
      setCursor: (position) => {
        const instance = view.current;
        if (!instance) return;
        const at = Math.max(0, Math.min(position, instance.state.doc.length));
        instance.dispatch({
          selection: { anchor: at },
          effects: EditorView.scrollIntoView(at, { y: "nearest" }),
        });
      },
      setCursorLine: (line) => {
        const instance = view.current;
        if (!instance) return;
        const number = Math.max(1, Math.min(line, instance.state.doc.lines));
        const at = instance.state.doc.line(number).from;
        instance.dispatch({
          selection: { anchor: at },
          effects: EditorView.scrollIntoView(at, { y: "start" }),
        });
      },
      focus: () => view.current?.focus(),
      cursorInfo: () => {
        const state = view.current?.state;
        if (!state) return { line: 1, column: 1, selected: 0, lines: 1 };
        const selection = state.selection.main;
        const line = state.doc.lineAt(selection.head);
        return {
          line: line.number,
          column: selection.head - line.from + 1,
          selected: Math.abs(selection.to - selection.from),
          lines: state.doc.lines,
        };
      },
    }),
    [handle],
  );

  return <div className="editor" ref={host} style={{ ["--editor-size" as string]: `${fontSize}px` }} />;
}

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((file) => file.type.startsWith("image/"));
}

async function insertImages(instance: EditorView, files: File[], docPath: string) {
  for (const file of files) {
    const ext = `.${(file.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    try {
      const relative = await Workspace.saveAsset(docPath, ext, btoa(binary));
      const name = relative.split("/").pop() ?? relative;
      instance.dispatch(instance.state.replaceSelection(`![${name}](${relative})`));
    } catch (err) {
      console.error("图片保存失败", err);
    }
  }
}
