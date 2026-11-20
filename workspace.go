package main

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Doc is what the frontend shows of a document. Its text stays in the page that
// edits it; everything the window, the tabs and the disk need is here.
type Doc struct {
	ID       string  `json:"id"`
	Path     string  `json:"path"`
	Title    string  `json:"title"`
	EOL      string  `json:"eol"`
	Encoding string  `json:"encoding"`
	ModTime  int64   `json:"modTime"`
	Dirty    bool    `json:"dirty"`
	Untitled bool    `json:"untitled"`
	Cursor   int     `json:"cursor"`
	Scroll   float64 `json:"scroll"`
	Missing  bool    `json:"missing"`
	External bool    `json:"external"`
	Size     int64   `json:"size"`
}

// WindowState is a window's tabs, in the order the tab bar shows them.
type WindowState struct {
	ID     int      `json:"id"`
	Docs   []string `json:"docs"`
	Active string   `json:"active"`
}

// State is everything the pages render, sent whole on every change.
type State struct {
	Windows []WindowState `json:"windows"`
	Docs    []Doc         `json:"docs"`
}

// WorkspaceChanged tells every window about a change to the shared state.
var WorkspaceChanged = mygo.NewEvent[State]("workspace-changed")

// ExternalChange tells a window that a file it shows was written by someone else.
var ExternalChange = mygo.NewEvent[string]("external-change")

// DragTarget tells a window that a dragged tab is over it, and which document.
var DragTarget = mygo.NewEvent[string]("drag-target")

// Workspace is the source of truth for windows, tabs and documents. The text of
// a document is not here: it lives in the page editing it, and only passes
// through on save or when a tab moves to another window.
type Workspace struct {
	mu      sync.Mutex
	windows map[int]*WindowState
	order   []int
	docs    map[string]*Doc
	native  map[int]*mygo.Window
	handoff map[string]string
	nextID  int
	active  int
	startup []string
	timer   *time.Timer
	target  int
}

var workspace = &Workspace{
	windows: map[int]*WindowState{},
	docs:    map[string]*Doc{},
	native:  map[int]*mygo.Window{},
	handoff: map[string]string{},
}

// Boot returns the state a page renders from, and registers the window the page
// runs in: its id comes from the URL, ?w=1.
func (s *Workspace) Boot(win int) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, ok := s.windows[win]
	if !ok {
		state = &WindowState{ID: win}
		s.windows[win] = state
		s.order = append(s.order, win)
	}
	s.active = win
	// A window without files opens with no tabs: the page shows where to start.
	return s.snapshotLocked(), nil
}

// State returns everything the pages render.
func (s *Workspace) State() (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked(), nil
}

// NewTab adds an empty document to a window and makes it the one showing.
func (s *Workspace) NewTab(win int) (Doc, error) {
	s.mu.Lock()
	state := s.windows[win]
	if state == nil {
		s.mu.Unlock()
		return Doc{}, fmt.Errorf("窗口不存在")
	}
	doc, err := s.addUntitledLocked(state)
	s.mu.Unlock()
	if err != nil {
		return Doc{}, err
	}
	s.publish()
	return doc, nil
}

// OpenDialog shows the system's open dialog and opens what the user picks.
func (s *Workspace) OpenDialog(win int) (Doc, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent: s.nativeWindow(win),
		Title:  "打开 Markdown 文档",
		Filters: []mygo.FileFilter{
			{Name: "Markdown", Extensions: []string{"md", "markdown", "mdown", "txt"}},
			{Name: "所有文件", Extensions: []string{"*"}},
		},
	})
	if err != nil || len(paths) == 0 {
		return Doc{}, err
	}
	return s.Open(win, paths[0])
}

// Open shows a file in a window, or focuses it where it is already open: the
// same file in two windows would let one overwrite what the other saved.
func (s *Workspace) Open(win int, path string) (Doc, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Doc{}, err
	}
	s.mu.Lock()
	for _, doc := range s.docs {
		if samePath(doc.Path, abs) {
			s.focusLocked(win, doc.ID)
			found := *doc
			target := s.windowOfLocked(doc.ID)
			s.mu.Unlock()
			s.publish()
			if native := s.nativeWindow(target); native != nil {
				native.Focus()
			}
			return found, nil
		}
	}
	file, err := readDocument(abs)
	if err != nil {
		s.mu.Unlock()
		return Doc{}, err
	}
	if file.size > maxDocumentSize {
		s.mu.Unlock()
		return Doc{}, fmt.Errorf("%s 有 %s，超过 %s 的上限，MDReader 不打开这么大的文件",
			filepath.Base(abs), humanSize(file.size), humanSize(maxDocumentSize))
	}
	state := s.windows[win]
	if state == nil {
		s.mu.Unlock()
		return Doc{}, fmt.Errorf("窗口不存在")
	}
	doc := s.newDocLocked(abs, file)
	// A fresh tab the user never typed into makes way for the file.
	if len(state.Docs) == 1 {
		if current := s.docs[state.Docs[0]]; current != nil && current.Untitled && !current.Dirty {
			delete(s.docs, current.ID)
			state.Docs = nil
		}
	}
	state.Docs = append(state.Docs, doc.ID)
	state.Active = doc.ID
	s.active = win
	opened := *doc
	s.mu.Unlock()
	if err := mygo.App.AddRecentDocument(abs); err != nil {
		log.Printf("无法记录最近文件: %v", err)
	}
	s.publish()
	return opened, nil
}

// Close closes a tab, and its window when it was the last one.
func (s *Workspace) Close(win int, id string) error {
	s.mu.Lock()
	state := s.windows[win]
	if state == nil {
		s.mu.Unlock()
		return nil
	}
	state.Docs = remove(state.Docs, id)
	delete(s.docs, id)
	if state.Active == id {
		state.Active = ""
		if n := len(state.Docs); n > 0 {
			state.Active = state.Docs[n-1]
		}
	}
	empty := len(state.Docs) == 0
	s.mu.Unlock()
	if empty {
		if native := s.nativeWindow(win); native != nil {
			native.Close()
			return nil
		}
	}
	s.publish()
	return nil
}

// Activate makes a tab the one showing.
func (s *Workspace) Activate(win int, id string) error {
	s.mu.Lock()
	if state := s.windows[win]; state != nil {
		state.Active = id
		s.active = win
	}
	s.mu.Unlock()
	s.publish()
	return nil
}

// Reorder stores the order the tab bar left its tabs in.
func (s *Workspace) Reorder(win int, ids []string) error {
	s.mu.Lock()
	if state := s.windows[win]; state != nil {
		state.Docs = ids
	}
	s.mu.Unlock()
	s.publish()
	return nil
}

// Detach moves a tab into a window of its own, where the pointer dropped it.
func (s *Workspace) Detach(win int, id string, x, y int) error {
	s.mu.Lock()
	state := s.windows[win]
	if state == nil || len(state.Docs) <= 1 {
		s.mu.Unlock()
		return fmt.Errorf("只有一个标签")
	}
	if _, ok := s.docs[id]; !ok {
		s.mu.Unlock()
		return nil
	}
	state.Docs = remove(state.Docs, id)
	if state.Active == id {
		state.Active = state.Docs[len(state.Docs)-1]
	}
	s.nextID++
	newWin := s.nextID
	created := &WindowState{ID: newWin, Docs: []string{id}, Active: id}
	s.windows[newWin] = created
	s.order = append(s.order, newWin)
	s.mu.Unlock()

	if native := createWindow(newWin, x-160, y-16); native != nil {
		s.mu.Lock()
		s.native[newWin] = native
		s.mu.Unlock()
	}
	s.publish()
	return nil
}

// maxDocumentSize is where a document stops being one this app can render.
const maxDocumentSize = 10 << 20

func humanSize(bytes int64) string {
	if bytes >= 1<<20 {
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1<<20))
	}
	return fmt.Sprintf("%d KB", bytes>>10)
}

// ExportPath asks where a self-contained copy of a document goes.
func (s *Workspace) ExportPath(win int, id string) (string, error) {
	s.mu.Lock()
	doc := s.docs[id]
	s.mu.Unlock()
	if doc == nil {
		return "", fmt.Errorf("文档不存在")
	}
	target := strings.TrimSuffix(doc.Path, filepath.Ext(doc.Path)) + ".html"
	return mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      s.nativeWindow(win),
		Title:       "导出 HTML",
		DefaultPath: target,
		Filters:     []mygo.FileFilter{{Name: "HTML", Extensions: []string{"html"}}},
	})
}

// WriteExport writes the HTML the page built, fonts and images included.
func (s *Workspace) WriteExport(path, html string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("没有选择文件")
	}
	if err := os.WriteFile(path, []byte(html), 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// DragOver reports the window a dragged tab is over, 0 for none, and tells that
// window to show where the tab would land.
func (s *Workspace) DragOver(win int, id string, x, y int) int {
	s.mu.Lock()
	type entry struct {
		id     int
		native *mygo.Window
	}
	list := make([]entry, 0, len(s.native))
	for wid, native := range s.native {
		if wid != win {
			list = append(list, entry{id: wid, native: native})
		}
	}
	previous := s.target
	s.mu.Unlock()

	target := 0
	for _, candidate := range list {
		px, py := candidate.native.Position()
		width, height := candidate.native.Size()
		if x >= px && x <= px+width && y >= py && y <= py+height {
			target = candidate.id
			break
		}
	}
	if target == previous {
		return target
	}
	s.mu.Lock()
	s.target = target
	previousWindow := s.native[previous]
	targetWindow := s.native[target]
	s.mu.Unlock()
	if previousWindow != nil {
		DragTarget.Emit(previousWindow, "")
	}
	if targetWindow != nil {
		DragTarget.Emit(targetWindow, id)
	}
	return target
}

// Drop moves a dragged tab to the window under the pointer, or to a window of
// its own there, and returns the window it landed in.
func (s *Workspace) Drop(win int, id string, x, y int) (int, error) {
	s.mu.Lock()
	target := s.target
	s.target = 0
	self := s.native[win]
	targetWindow := s.native[target]
	s.mu.Unlock()
	if targetWindow != nil {
		DragTarget.Emit(targetWindow, "")
	}
	if target == win {
		target = 0
	}
	// Dropped back where it came from: the tab bar already has the new order.
	if target == 0 && self != nil {
		px, py := self.Position()
		width, height := self.Size()
		if x >= px && x <= px+width && y >= py && y <= py+height {
			return 0, nil
		}
	}
	s.mu.Lock()
	source := s.windows[win]
	targetState := s.windows[target]
	s.mu.Unlock()
	if target != 0 && target != win && source != nil && targetState != nil {
		s.mu.Lock()
		source.Docs = remove(source.Docs, id)
		if source.Active == id {
			if len(source.Docs) > 0 {
				source.Active = source.Docs[len(source.Docs)-1]
			} else {
				source.Active = ""
			}
		}
		targetState.Docs = append(targetState.Docs, id)
		targetState.Active = id
		s.active = target
		empty := len(source.Docs) == 0
		s.mu.Unlock()
		s.publish()
		if native := s.nativeWindow(target); native != nil {
			native.Focus()
		}
		if empty {
			if native := s.nativeWindow(win); native != nil {
				native.Close()
			}
		}
		return target, nil
	}
	return 0, s.Detach(win, id, x, y)
}

// SaveAsset writes a picture pasted or dropped into a document beside it, in
// ./assets, and returns the path the Markdown links to.
func (s *Workspace) SaveAsset(docPath, ext, data string) (string, error) {
	if docPath == "" {
		return "", fmt.Errorf("请先保存文档")
	}
	switch strings.ToLower(ext) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp":
	default:
		return "", fmt.Errorf("不支持的图片格式: %s", ext)
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(filepath.Dir(docPath), "assets")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := "image-" + time.Now().Format("20060102-150405.000") + strings.ToLower(ext)
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return "", err
	}
	rel, err := filepath.Rel(filepath.Dir(docPath), path)
	if err != nil {
		return filepath.ToSlash(path), nil
	}
	return filepath.ToSlash(rel), nil
}

// SetDefaultApp opens the part of Settings where .md files are given to the app:
// Windows keeps that choice to the user.
func (s *Workspace) SetDefaultApp() error {
	return mygo.Shell.OpenExternal("ms-settings:defaultapps")
}

// Recent returns the files the app opened lately, newest first.
func (s *Workspace) Recent() []string {
	return mygo.App.RecentDocuments()
}

// Handoff takes a document's text from the page that shows it, so that another
// window can show the same unsaved text once the tab moves there.
func (s *Workspace) Handoff(id, content string) error {
	s.mu.Lock()
	s.handoff[id] = content
	s.mu.Unlock()
	return nil
}

// Content returns a document's text: what a page handed off, or what is on disk.
func (s *Workspace) Content(id string) (string, error) {
	s.mu.Lock()
	if content, ok := s.handoff[id]; ok {
		delete(s.handoff, id)
		s.mu.Unlock()
		return content, nil
	}
	doc := s.docs[id]
	if doc == nil {
		s.mu.Unlock()
		return "", fmt.Errorf("文档不存在")
	}
	path := doc.Path
	s.mu.Unlock()

	file, err := readDocument(path)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	if doc := s.docs[id]; doc != nil {
		doc.ModTime = file.modTime
		doc.Size = file.size
		doc.Missing = false
	}
	s.mu.Unlock()
	return file.content, nil
}

// SetDirty tells whether a document has changes the file does not have yet.
func (s *Workspace) SetDirty(id string, dirty bool) error {
	s.mu.Lock()
	if doc := s.docs[id]; doc != nil && doc.Dirty != dirty {
		doc.Dirty = dirty
	}
	s.mu.Unlock()
	s.publish()
	return nil
}

// SetView keeps where the reader was in a document, for the next launch.
func (s *Workspace) SetView(id string, cursor int, scroll float64) error {
	s.mu.Lock()
	if doc := s.docs[id]; doc != nil {
		doc.Cursor = cursor
		doc.Scroll = scroll
	}
	st := s.snapshotLocked()
	s.mu.Unlock()
	scheduleSession(st)
	return nil
}

// SetFormat changes the line endings and the encoding the next save writes.
// The status bar calls it, then saves at once, so the file on disk matches
// what the bar shows.
func (s *Workspace) SetFormat(id, eol, encoding string) (Doc, error) {
	switch eol {
	case "\n", "\r\n", "\r":
	default:
		return Doc{}, fmt.Errorf("不支持的换行符")
	}
	switch encoding {
	case encUTF8, encUTF8BOM, encGBK, encUTF16LE, encUTF16BE:
	default:
		return Doc{}, fmt.Errorf("不支持的编码: %s", encoding)
	}
	s.mu.Lock()
	doc := s.docs[id]
	if doc == nil {
		s.mu.Unlock()
		return Doc{}, fmt.Errorf("文档不存在")
	}
	doc.EOL = eol
	doc.Encoding = encoding
	doc.Dirty = true
	saved := *doc
	s.mu.Unlock()
	s.publish()
	return saved, nil
}

// Save writes a document's text into its file, in the line endings and encoding
// it had, after keeping the previous version in .mdr-history.
func (s *Workspace) Save(id, content string) (Doc, error) {
	s.mu.Lock()
	doc := s.docs[id]
	if doc == nil {
		s.mu.Unlock()
		return Doc{}, fmt.Errorf("文档不存在")
	}
	path, eol, encoding := doc.Path, doc.EOL, doc.Encoding
	s.mu.Unlock()

	modTime, size, err := writeDocument(path, content, eol, encoding)
	if err != nil {
		return Doc{}, err
	}
	s.mu.Lock()
	if doc := s.docs[id]; doc != nil {
		doc.ModTime = modTime
		doc.Size = size
		doc.Dirty = false
		doc.External = false
		doc.Missing = false
	}
	saved := *s.docs[id]
	s.mu.Unlock()
	s.publish()
	return saved, nil
}

// SaveAs saves a new document under a name the user picks, and forgets the
// placeholder it was created with.
func (s *Workspace) SaveAs(win int, id, content string) (Doc, error) {
	s.mu.Lock()
	doc := s.docs[id]
	if doc == nil {
		s.mu.Unlock()
		return Doc{}, fmt.Errorf("文档不存在")
	}
	title := doc.Title + ".md"
	untitled := doc.Untitled
	previous := doc.Path
	s.mu.Unlock()

	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      s.nativeWindow(win),
		Title:       "另存为",
		DefaultPath: filepath.Join(filepath.Dir(previous), title),
		Filters:     []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md"}}},
	})
	if err != nil || path == "" {
		return Doc{}, err
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		os.WriteFile(path, nil, 0o644)
	}
	modTime, size, err := writeDocument(path, content, doc.EOL, doc.Encoding)
	if err != nil {
		return Doc{}, err
	}
	if untitled {
		os.Remove(previous)
	}
	s.mu.Lock()
	if doc := s.docs[id]; doc != nil {
		doc.Path = path
		doc.Title = baseTitle(path)
		doc.Untitled = false
		doc.ModTime = modTime
		doc.Size = size
		doc.Dirty = false
		doc.External = false
	}
	saved := *s.docs[id]
	s.mu.Unlock()
	s.publish()
	return saved, nil
}

// Reload reads a document again after another program wrote it.
func (s *Workspace) Reload(id string) (string, error) {
	s.mu.Lock()
	doc := s.docs[id]
	if doc == nil {
		s.mu.Unlock()
		return "", fmt.Errorf("文档不存在")
	}
	path := doc.Path
	s.mu.Unlock()

	file, err := readDocument(path)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	if doc := s.docs[id]; doc != nil {
		doc.ModTime = file.modTime
		doc.Size = file.size
		doc.Dirty = false
		doc.External = false
		doc.Missing = false
		doc.EOL = file.eol
		doc.Encoding = file.encoding
	}
	s.mu.Unlock()
	s.publish()
	return file.content, nil
}

// KeepDraft keeps the text of a page when the file changed on disk, and takes
// the file's new details as the ones to compare against from now on.
func (s *Workspace) KeepDraft(id string) error {
	s.mu.Lock()
	doc := s.docs[id]
	if doc == nil {
		s.mu.Unlock()
		return nil
	}
	path := doc.Path
	s.mu.Unlock()
	if st, err := os.Stat(path); err == nil {
		s.mu.Lock()
		if doc := s.docs[id]; doc != nil {
			doc.ModTime = st.ModTime().UnixMilli()
			doc.Size = st.Size()
			doc.External = false
		}
		s.mu.Unlock()
	}
	s.publish()
	return nil
}

// Reveal shows a document in Explorer.
func (s *Workspace) Reveal(id string) error {
	s.mu.Lock()
	doc := s.docs[id]
	s.mu.Unlock()
	if doc == nil {
		return nil
	}
	mygo.Shell.ShowItemInFolder(doc.Path)
	return nil
}

// OpenExternalFiles opens the files the app was started with, or ones the file
// manager asked it to open while it ran.
func (s *Workspace) OpenExternalFiles() {
	s.mu.Lock()
	paths := s.startup
	s.startup = nil
	win := s.active
	s.mu.Unlock()
	if len(paths) == 0 {
		return
	}
	if win == 0 {
		win = s.createStartupWindow()
	}
	for _, path := range paths {
		if _, err := s.Open(win, path); err != nil {
			log.Printf("无法打开 %s: %v", path, err)
		}
	}
	if native := s.nativeWindow(win); native != nil {
		native.Focus()
	}
}

// ---- internals ----

func (s *Workspace) snapshotLocked() State {
	st := State{Windows: make([]WindowState, 0, len(s.order))}
	for _, id := range s.order {
		state := s.windows[id]
		if state == nil {
			continue
		}
		st.Windows = append(st.Windows, *state)
		for _, docID := range state.Docs {
			if doc := s.docs[docID]; doc != nil {
				st.Docs = append(st.Docs, *doc)
			}
		}
	}
	return st
}

func (s *Workspace) publish() {
	s.mu.Lock()
	st := s.snapshotLocked()
	natives := make([]*mygo.Window, 0, len(s.native))
	for _, native := range s.native {
		natives = append(natives, native)
	}
	s.mu.Unlock()
	for _, native := range natives {
		WorkspaceChanged.Emit(native, st)
	}
	scheduleSession(st)
}

func (s *Workspace) nativeWindow(win int) *mygo.Window {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.native[win]
}

func (s *Workspace) windowOfLocked(id string) int {
	for _, win := range s.order {
		state := s.windows[win]
		if state == nil {
			continue
		}
		for _, docID := range state.Docs {
			if docID == id {
				return win
			}
		}
	}
	return 0
}

func (s *Workspace) focusLocked(win int, id string) {
	if state := s.windows[win]; state != nil {
		state.Active = id
		s.active = win
		return
	}
	if target := s.windowOfLocked(id); target != 0 {
		s.windows[target].Active = id
		s.active = target
	}
}

func (s *Workspace) addUntitledLocked(state *WindowState) (Doc, error) {
	path, err := untitledFile()
	if err != nil {
		return Doc{}, err
	}
	file, err := readDocument(path)
	if err != nil {
		return Doc{}, err
	}
	doc := s.newDocLocked(path, file)
	doc.Untitled = true
	doc.Title = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	state.Docs = append(state.Docs, doc.ID)
	state.Active = doc.ID
	return *doc, nil
}

func (s *Workspace) newDocLocked(path string, file document) *Doc {
	s.nextID++
	id := fmt.Sprintf("d%d", s.nextID)
	doc := &Doc{
		ID:       id,
		Path:     path,
		Title:    baseTitle(path),
		EOL:      file.eol,
		Encoding: file.encoding,
		ModTime:  file.modTime,
		Size:     file.size,
	}
	doc.Untitled = isUntitled(path)
	s.docs[id] = doc
	return doc
}

func (s *Workspace) removeWindow(win int) {
	s.mu.Lock()
	state := s.windows[win]
	if state != nil {
		for _, id := range state.Docs {
			delete(s.docs, id)
		}
	}
	delete(s.windows, win)
	delete(s.native, win)
	kept := s.order[:0]
	for _, id := range s.order {
		if id != win {
			kept = append(kept, id)
		}
	}
	s.order = kept
	if s.active == win {
		s.active = 0
	}
	st := s.snapshotLocked()
	s.mu.Unlock()
	s.mu.Lock()
	natives := make([]*mygo.Window, 0, len(s.native))
	for _, native := range s.native {
		natives = append(natives, native)
	}
	s.mu.Unlock()
	for _, native := range natives {
		WorkspaceChanged.Emit(native, st)
	}
	writeSession(st)
}

func (s *Workspace) setActive(win int) {
	s.mu.Lock()
	s.active = win
	s.mu.Unlock()
}

func (s *Workspace) queueFile(path string) {
	s.mu.Lock()
	s.startup = append(s.startup, path)
	started := len(s.native) > 0
	s.mu.Unlock()
	if started {
		s.OpenExternalFiles()
	}
}

// createStartupWindow makes the window the app opens with.
func (s *Workspace) createStartupWindow() int {
	s.mu.Lock()
	s.nextID++
	id := s.nextID
	s.windows[id] = &WindowState{ID: id}
	s.order = append(s.order, id)
	s.active = id
	s.mu.Unlock()
	if native := createWindow(id, 0, 0); native != nil {
		s.mu.Lock()
		s.native[id] = native
		s.mu.Unlock()
	}
	return id
}

// ---- helpers ----

func createWindow(id, x, y int) *mygo.Window {
	native := mygo.NewWindow(mygo.WindowOptions{
		Title:           "MDReader",
		Width:           1200,
		Height:          820,
		MinWidth:        720,
		MinHeight:       520,
		Frameless:       true,
		BackgroundColor: "light-dark(#f2f2f7, #141416)",
		StateKey:        fmt.Sprintf("win-%d", id),
		URL:             fmt.Sprintf("/?w=%d", id),
	})
	if native == nil {
		return nil
	}
	if x != 0 || y != 0 {
		native.SetPosition(x, y)
	}
	native.OnFocus(func() { workspace.setActive(id) })
	native.OnClosed(func() { workspace.removeWindow(id) })
	return native
}

// watchExternal notices the files other programs write while they are open.
func watchExternal() {
	for range time.Tick(2 * time.Second) {
		workspace.mu.Lock()
		type changed struct {
			id  string
			win int
		}
		var hits []changed
		for id, doc := range workspace.docs {
			if doc.Path == "" || doc.External {
				continue
			}
			st, err := os.Stat(doc.Path)
			if err != nil {
				if os.IsNotExist(err) && !doc.Missing {
					doc.Missing = true
					hits = append(hits, changed{id: id, win: workspace.windowOfLocked(id)})
				}
				continue
			}
			if doc.Missing {
				doc.Missing = false
				hits = append(hits, changed{id: id, win: workspace.windowOfLocked(id)})
			}
			if st.ModTime().UnixMilli() != doc.ModTime || st.Size() != doc.Size {
				doc.External = true
				hits = append(hits, changed{id: id, win: workspace.windowOfLocked(id)})
			}
		}
		targets := map[int]*mygo.Window{}
		for _, hit := range hits {
			if native := workspace.native[hit.win]; native != nil {
				targets[hit.win] = native
			}
		}
		workspace.mu.Unlock()

		if len(hits) == 0 {
			continue
		}
		for _, hit := range hits {
			if native := targets[hit.win]; native != nil {
				ExternalChange.Emit(native, hit.id)
			}
		}
	}
}

func samePath(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

func baseTitle(path string) string {
	base := filepath.Base(path)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func isUntitled(path string) bool {
	dir, err := os.UserConfigDir()
	if err != nil {
		return false
	}
	return strings.HasPrefix(strings.ToLower(path), strings.ToLower(filepath.Join(dir, "MDReader", "untitled")))
}

func remove(list []string, target string) []string {
	out := list[:0]
	for _, item := range list {
		if item != target {
			out = append(out, item)
		}
	}
	return out
}
