import { onFileDrop } from "mygo-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { events, Workspace, type Doc, type State } from "../mygo";

const AUTOSAVE_DELAY = 800;

export interface Notice {
  id: string;
  kind: "external" | "error";
  title: string;
  text: string;
}

/**
 * useWorkspace mirrors the Go side's window and tabs, and keeps the text of the
 * document showing here. The metadata is Go's; the text never leaves this page
 * except to be saved or handed to another window.
 */
export function useWorkspace() {
  const win = useMemo(() => Number(new URLSearchParams(location.search).get("w") ?? "0"), []);
  const [state, setState] = useState<State | null>(null);
  const [buffers, setBuffers] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const view = useRef<Record<string, { cursor: number; scroll: number }>>({});

  const mine = state?.windows.find((window) => window.id === win);
  const docs = useMemo(() => {
    if (!state || !mine) return [];
    return mine.docs.map((id) => state.docs.find((doc) => doc.id === id)).filter((doc): doc is Doc => !!doc);
  }, [state, mine]);
  const active = docs.find((doc) => doc.id === mine?.active) ?? docs[0] ?? null;

  const activeRef = useRef<Doc | null>(active);
  activeRef.current = active;

  const warn = useCallback((err: unknown) => {
    setNotice({ id: "", kind: "error", title: "", text: message(err) });
  }, []);


  useEffect(() => {
    let alive = true;
    void Workspace.boot(win).then((initial) => {
      if (alive) setState(initial);
    });
    const offs = [
      events.workspaceChanged.on((next) => setState(next)),
      events.dragTarget.on((id) => setDropTarget(id || null)),
      events.externalChange.on((id) => {
        const doc = id;
        setState((current) => {
          const found = current?.docs.find((item) => item.id === doc);
          if (found) setNotice({ id: doc, kind: "external", title: found.title, text: "文件已被其他程序修改" });
          return current;
        });
      }),
    ];
    return () => {
      alive = false;
      for (const off of offs) off();
    };
  }, [win]);

  // Files dropped on the window open like the ones from Explorer.
  useEffect(
    () =>
      onFileDrop(({ paths }) => {
        for (const path of paths) void Workspace.open(win, path).catch((err) => warn(err));
      }),
    [win, warn],
  );

  // The text of the document showing here, read once.
  useEffect(() => {
    if (!active || buffersRef.current[active.id] !== undefined) return;
    let alive = true;
    void Workspace.content(active.id).then((text) => {
      if (alive) setBuffers((current) => ({ ...current, [active.id]: text }));
    });
    return () => {
      alive = false;
    };
  }, [active]);

  const persist = useCallback(async (id: string, text: string, force = false) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    try {
      await Workspace.save(id, text);
      if (force) await Workspace.setDirty(id, false);
    } catch (err) {
      setNotice({ id, kind: "error", title: "", text: `保存失败：${message(err)}` });
    }
  }, []);

  const edit = useCallback(
    (text: string) => {
      const doc = activeRef.current;
      if (!doc) return;
      setBuffers((current) => ({ ...current, [doc.id]: text }));
      void Workspace.setDirty(doc.id, true);
      clearTimeout(timers.current[doc.id]);
      timers.current[doc.id] = setTimeout(() => void persist(doc.id, text), AUTOSAVE_DELAY);
    },
    [persist],
  );

  const saveAs = useCallback(async () => {
    const doc = activeRef.current;
    if (!doc) return;
    const text = buffersRef.current[doc.id] ?? "";
    try {
      const saved = await Workspace.saveAs(win, doc.id, text);
      if (saved.id) setBuffers((current) => ({ ...current, [saved.id]: text }));
    } catch (err) {
      setNotice({ id: doc.id, kind: "error", title: doc.title, text: `另存为失败：${message(err)}` });
    }
  }, [win]);

  const save = useCallback(async () => {
    const doc = activeRef.current;
    if (!doc) return;
    const text = buffersRef.current[doc.id] ?? "";
    if (doc.untitled) {
      await saveAs();
      return;
    }
    await persist(doc.id, text, true);
  }, [persist, saveAs]);

  const actions = useMemo(
    () => ({
      openDialog: () => void Workspace.openDialog(win).catch((err) => warn(err)),
      open: (path: string) => void Workspace.open(win, path).catch((err) => warn(err)),
      newTab: () => void Workspace.newTab(win),
      closeTab: (id: string) => {
        const doc = state?.docs.find((item) => item.id === id);
        const text = buffersRef.current[id];
        if (doc?.dirty && text !== undefined) void Workspace.save(id, text);
        void Workspace.close(win, id);
      },
      activate: (id: string) => void Workspace.activate(win, id),
      reorder: (ids: string[]) => void Workspace.reorder(win, ids),
      detach: async (id: string, x: number, y: number) => {
        const text = buffersRef.current[id];
        if (text !== undefined) await Workspace.handoff(id, text);
        await Workspace.detach(win, id, x, y);
      },
      dragOver: (id: string, x: number, y: number) => void Workspace.dragOver(win, id, x, y),
      drop: async (id: string, x: number, y: number) => {
        const text = buffersRef.current[id];
        if (text !== undefined) await Workspace.handoff(id, text);
        setDropTarget(null);
        await Workspace.drop(win, id, x, y).catch((err) => warn(err));
      },
      exportHTML: async (html: string) => {
        const doc = activeRef.current;
        if (!doc) return;
        const path = await Workspace.exportPath(win, doc.id).catch((err) => {
          warn(err);
          return "";
        });
        if (!path) return;
        try {
          await Workspace.writeExport(path, html);
        } catch (err) {
          warn(err);
        }
      },
      recent: () => Workspace.recent(),
      setDefaultApp: () => void Workspace.setDefaultApp(),
      reveal: (id: string) => void Workspace.reveal(id),
      reload: async (id: string) => {
        const text = await Workspace.reload(id).catch((err) => {
          warn(err);
          return "";
        });
        if (text === "") return;
        setBuffers((current) => ({ ...current, [id]: text }));
        setNotice(null);
      },
      keepDraft: async (id: string) => {
        await Workspace.keepDraft(id);
        setNotice(null);
      },
      dismissNotice: () => setNotice(null),
      /* Where the reader was, for the next launch. */
      rememberView: (id: string, cursor: number, scroll: number) => {
        view.current[id] = { cursor, scroll };
        clearTimeout(timers.current[`view-${id}`]);
        timers.current[`view-${id}`] = setTimeout(() => void Workspace.setView(id, cursor, scroll), 600);
      },
      savedView: (id: string) => view.current[id],
    }),
    [state, win, warn],
  );

  return {
    win,
    state,
    docs,
    active,
    buffer: active ? (buffers[active.id] ?? "") : "",
    loaded: !active || buffers[active.id] !== undefined,
    notice,
    dropTarget,
    edit,
    save,
    saveAs,
    ...actions,
  };
}

function message(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error:\s*/, "");
}
