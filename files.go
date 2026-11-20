package main

import (
	"bytes"
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
	"unicode/utf8"

	"github.com/egoist/mygo"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
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

// The encodings a document can be opened and saved as. The page shows these
// names in the status bar; they are not i18n keys.
const (
	encUTF8    = "utf-8"
	encUTF8BOM = "utf-8-bom"
	encGBK     = "gbk"
	encUTF16LE = "utf-16le"
	encUTF16BE = "utf-16be"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

type document struct {
	content  string
	eol      string
	encoding string
	modTime  int64
	size     int64
}

func readDocument(path string) (document, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return document{}, err
	}
	doc := document{encoding: encUTF8, eol: "\n", size: int64(len(raw))}

	switch {
	case bytes.HasPrefix(raw, utf8BOM):
		doc.encoding = encUTF8BOM
		raw = raw[len(utf8BOM):]
	case bytes.HasPrefix(raw, []byte{0xFF, 0xFE}):
		doc.encoding = encUTF16LE
		decoded, err := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder().Bytes(raw[2:])
		if err != nil {
			return document{}, fmt.Errorf("UTF-16 LE 解码失败: %w", err)
		}
		raw = decoded
	case bytes.HasPrefix(raw, []byte{0xFE, 0xFF}):
		doc.encoding = encUTF16BE
		decoded, err := unicode.UTF16(unicode.BigEndian, unicode.IgnoreBOM).NewDecoder().Bytes(raw[2:])
		if err != nil {
			return document{}, fmt.Errorf("UTF-16 BE 解码失败: %w", err)
		}
		raw = decoded
	case utf8.Valid(raw):
		doc.encoding = encUTF8
	default:
		// Not valid UTF-8: the Chinese Windows default is GBK, which is what
		// a file from an older editor is almost always.
		decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(raw)
		if err != nil {
			return document{}, fmt.Errorf("无法识别文件编码（既不是 UTF-8，也不是 GBK）")
		}
		doc.encoding = encGBK
		raw = decoded
	}

	text := string(raw)
	doc.eol = detectEOL(text)
	doc.content = normalizeEOL(text)
	if st, err := os.Stat(path); err == nil {
		doc.modTime = st.ModTime().UnixMilli()
	}
	return doc, nil
}

// writeDocument writes the content in the line endings and encoding the
// document has, keeping up to historyLimit copies of what it replaces.
func writeDocument(path, content, eol, encoding string) (modTime, size int64, err error) {
	if path == "" {
		return 0, 0, fmt.Errorf("没有可写入的文件路径")
	}
	switch eol {
	case "\r\n":
		content = strings.ReplaceAll(content, "\n", "\r\n")
	case "\r":
		content = strings.ReplaceAll(content, "\n", "\r")
	case "\n", "":
		content = strings.ReplaceAll(content, "\r\n", "\n")
	default:
		return 0, 0, fmt.Errorf("不支持的换行符: %q", eol)
	}
	raw, err := encodeText(content, encoding)
	if err != nil {
		return 0, 0, err
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

func encodeText(text, encoding string) ([]byte, error) {
	switch encoding {
	case "", encUTF8:
		return []byte(text), nil
	case encUTF8BOM:
		return append(append([]byte{}, utf8BOM...), []byte(text)...), nil
	case encGBK:
		encoded, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte(text))
		if err != nil {
			return nil, fmt.Errorf("有字符无法用 GBK 保存，请换回 UTF-8")
		}
		return encoded, nil
	case encUTF16LE:
		return unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewEncoder().Bytes([]byte(text))
	case encUTF16BE:
		return unicode.UTF16(unicode.BigEndian, unicode.UseBOM).NewEncoder().Bytes([]byte(text))
	}
	return nil, fmt.Errorf("不支持的编码: %s", encoding)
}

// detectEOL names the line endings a file already uses; CRLF wins a mixed file
// because that is what a Windows editor wrote.
func detectEOL(text string) string {
	switch {
	case strings.Contains(text, "\r\n"):
		return "\r\n"
	case strings.Contains(text, "\r"):
		return "\r"
	}
	return "\n"
}

// normalizeEOL is the text the editor edits: LF only.
func normalizeEOL(text string) string {
	if strings.Contains(text, "\r") {
		text = strings.ReplaceAll(text, "\r\n", "\n")
		text = strings.ReplaceAll(text, "\r", "\n")
	}
	return text
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
