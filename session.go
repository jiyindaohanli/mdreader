package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type sessionDoc struct {
	Path     string  `json:"path"`
	Untitled bool    `json:"untitled"`
	Cursor   int     `json:"cursor"`
	Scroll   float64 `json:"scroll"`
}

type sessionWindow struct {
	Active int          `json:"active"`
	Docs   []sessionDoc `json:"docs"`
}

type sessionFile struct {
	Windows []sessionWindow `json:"windows"`
}

// scheduleSession writes the layout a second and a half after it last changed,
// so that scrolling and moving the caret do not write the disk on every event.
func scheduleSession(st State) {
	workspace.mu.Lock()
	if workspace.timer != nil {
		workspace.timer.Stop()
	}
	workspace.timer = time.AfterFunc(1500*time.Millisecond, func() { writeSession(st) })
	workspace.mu.Unlock()
}

func writeSession(st State) {
	docs := make(map[string]Doc, len(st.Docs))
	for _, doc := range st.Docs {
		docs[doc.ID] = doc
	}
	session := sessionFile{}
	for _, win := range st.Windows {
		w := sessionWindow{}
		for _, id := range win.Docs {
			doc, ok := docs[id]
			if !ok {
				continue
			}
			if doc.ID == win.Active {
				w.Active = len(w.Docs)
			}
			w.Docs = append(w.Docs, sessionDoc{
				Path:     doc.Path,
				Untitled: doc.Untitled,
				Cursor:   doc.Cursor,
				Scroll:   doc.Scroll,
			})
		}
		if len(w.Docs) > 0 {
			session.Windows = append(session.Windows, w)
		}
	}
	raw, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return
	}
	dir := appData()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	os.WriteFile(filepath.Join(dir, "session.json"), raw, 0o644)
}

// restoreSession reopens the windows and tabs of the last run, skipping the
// files that are no longer there. It reports whether it restored anything.
func restoreSession() bool {
	raw, err := os.ReadFile(filepath.Join(appData(), "session.json"))
	if err != nil {
		return false
	}
	var session sessionFile
	if err := json.Unmarshal(raw, &session); err != nil {
		return false
	}
	restored := 0
	for _, win := range session.Windows {
		type restoredDoc struct {
			path   string
			file   document
			cursor int
			scroll float64
		}
		var docs []restoredDoc
		for _, doc := range win.Docs {
			if doc.Path == "" {
				continue
			}
			file, err := readDocument(doc.Path)
			if err != nil {
				continue
			}
			docs = append(docs, restoredDoc{path: doc.Path, file: file, cursor: doc.Cursor, scroll: doc.Scroll})
		}
		if len(docs) == 0 {
			continue
		}
		id := workspace.createStartupWindow()
		workspace.mu.Lock()
		state := workspace.windows[id]
		for i, saved := range docs {
			doc := workspace.newDocLocked(saved.path, saved.file)
			doc.Cursor = saved.cursor
			doc.Scroll = saved.scroll
			state.Docs = append(state.Docs, doc.ID)
			if i == win.Active {
				state.Active = doc.ID
			}
		}
		if state.Active == "" {
			state.Active = state.Docs[0]
		}
		workspace.mu.Unlock()
		restored++
	}
	return restored > 0
}
