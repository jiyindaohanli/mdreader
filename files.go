package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/egoist/mygo"
)

// Files is bound to the frontend for what no document owns: images beside it,
// and links.
type Files struct{}

// Asset returns an image beside the document as a data URL, so that relative
// paths show up in the preview the page draws.
func (Files) Asset(docPath, src string) (string, error) {
	p := src
	if !filepath.IsAbs(p) {
		p = filepath.Join(filepath.Dir(docPath), filepath.FromSlash(p))
	}
	ext := strings.ToLower(filepath.Ext(p))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif":
	default:
		return "", fmt.Errorf("不是图片: %s", src)
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	typ := mime.TypeByExtension(ext)
	if typ == "" {
		typ = "application/octet-stream"
	}
	return "data:" + typ + ";base64," + base64.StdEncoding.EncodeToString(b), nil
}

// OpenURL opens a link in the system's browser.
func (Files) OpenURL(url string) error {
	return mygo.Shell.OpenExternal(url)
}

type document struct {
	content string
	eol     string
	bom     bool
	modTime int64
	size    int64
}

func readDocument(path string) (document, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return document{}, err
	}
	doc := document{eol: "\n", size: int64(len(raw))}
	if strings.HasPrefix(string(raw), "\ufeff") {
		doc.bom = true
		raw = raw[3:]
	}
	text := string(raw)
	if strings.Contains(text, "\r\n") {
		doc.eol = "\r\n"
	}
	doc.content = strings.ReplaceAll(text, "\r\n", "\n")
	if st, err := os.Stat(path); err == nil {
		doc.modTime = st.ModTime().UnixMilli()
	}
	return doc, nil
}

// writeDocument writes the content in the line endings and encoding the
// document had, keeping up to historyLimit copies of what it replaces.
func writeDocument(path, content, eol string, bom bool) (modTime, size int64, err error) {
	if path == "" {
		return 0, 0, fmt.Errorf("没有可写入的文件路径")
	}
	if eol == "\r\n" {
		content = strings.ReplaceAll(content, "\n", "\r\n")
	}
	raw := []byte(content)
	if bom {
		raw = append([]byte("\ufeff"), raw...)
	}
	if previous, err := os.ReadFile(path); err == nil && string(previous) != string(raw) {
		snapshot(path, previous)
	} else if err != nil && !os.IsNotExist(err) {
		return 0, 0, err
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		return 0, 0, describeWriteError(err)
	}
	st, err := os.Stat(path)
	if err != nil {
		return 0, 0, err
	}
	return st.ModTime().UnixMilli(), st.Size(), nil
}

// describeWriteError says what stopped a save, in words a reader can act on.
func describeWriteError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, fs.ErrPermission):
		return fmt.Errorf("文件是只读的，或者没有写入权限")
	case errors.Is(err, fs.ErrNotExist):
		return fmt.Errorf("文件或它的目录已经不存在")
	case errors.Is(err, syscall.ENOSPC):
		return fmt.Errorf("磁盘空间不足")
	}
	return err
}

const historyLimit = 10

// snapshot keeps a copy of the file as it was before an overwrite, so that a
// save that loses something can be undone: .mdr-history/<name>/<name>-<time>.md
func snapshot(path string, previous []byte) {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	dir := filepath.Join(filepath.Dir(path), ".mdr-history", base)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	name := fmt.Sprintf("%s-%s%s", base, time.Now().Format("20060102-150405.000"), filepath.Ext(path))
	if err := os.WriteFile(filepath.Join(dir, name), previous, 0o644); err != nil {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	if len(names) <= historyLimit {
		return
	}
	sort.Strings(names)
	for _, old := range names[:len(names)-historyLimit] {
		os.Remove(filepath.Join(dir, old))
	}
}

// appData is %AppData%\MDReader.
func appData() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "MDReader")
}

// untitledFile creates an empty document for a new tab, on disk from the start
// so that nothing typed into it can be lost.
func untitledFile() (string, error) {
	dir := filepath.Join(appData(), "untitled")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	for n := 1; ; n++ {
		path := filepath.Join(dir, fmt.Sprintf("未命名-%d.md", n))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if err := os.WriteFile(path, nil, 0o644); err != nil {
				return "", err
			}
			return path, nil
		}
	}
}
