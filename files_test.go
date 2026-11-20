package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fixture copies fixtures/<name> into a scratch directory and returns its path.
// The fixture itself must stay untouched: its bytes are the expectation.
func fixture(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("fixtures", name))
	if err != nil {
		t.Fatalf("读取用例 %s: %v", name, err)
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatalf("复制用例: %v", err)
	}
	return path
}

// The regression case the README promises: a UTF-8 BOM + CRLF file opens, and
// saving it without edits writes the same bytes back.
func TestOpenThenSaveKeepsBOMAndCRLF(t *testing.T) {
	path := fixture(t, "all-features.md")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(original, []byte("\xef\xbb\xbf")) {
		t.Fatal("用例本身不再是 BOM 开头的 UTF-8")
	}
	if !bytes.Contains(original, []byte("\r\n")) {
		t.Fatal("用例本身不再用 CRLF 换行")
	}

	doc, err := readDocument(path)
	if err != nil {
		t.Fatalf("readDocument: %v", err)
	}
	if doc.encoding != encUTF8BOM {
		t.Errorf("编码 = %q，想要 UTF-8 BOM", doc.encoding)
	}
	if doc.eol != "\r\n" {
		t.Errorf("换行 = %q，想要 CRLF", doc.eol)
	}
	if strings.Contains(doc.content, "\r") {
		t.Error("交给编辑器的文本里不应残留 \\r")
	}
	if doc.size != int64(len(original)) {
		t.Errorf("大小 = %d，文件是 %d", doc.size, len(original))
	}

	if _, _, err := writeDocument(path, doc.content, doc.eol, doc.encoding); err != nil {
		t.Fatalf("writeDocument: %v", err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved, original) {
		t.Fatalf("原样保存改变了字节：%d → %d", len(original), len(saved))
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(path), ".mdr-history")); !os.IsNotExist(err) {
		t.Error("内容没变也写了历史快照")
	}
}

// Editing a file keeps its BOM and CRLF, and the replaced version goes to
// .mdr-history untouched.
func TestEditKeepsBOMAndCRLFAndSnapshotsPrevious(t *testing.T) {
	path := fixture(t, "all-features.md")
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := readDocument(path)
	if err != nil {
		t.Fatal(err)
	}

	edited := doc.content + "\n新增的一行。\n"
	if _, _, err := writeDocument(path, edited, doc.eol, doc.encoding); err != nil {
		t.Fatalf("writeDocument: %v", err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(saved, []byte("\xef\xbb\xbf")) {
		t.Error("保存后 BOM 丢了")
	}
	if want := append(original, []byte("\r\n新增的一行。\r\n")...); !bytes.Equal(saved, want) {
		t.Fatalf("保存结果不对：末尾 %q", saved[max(0, len(saved)-40):])
	}

	snapshots, err := os.ReadDir(filepath.Join(filepath.Dir(path), ".mdr-history", "all-features"))
	if err != nil {
		t.Fatalf("没有历史快照: %v", err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("快照数 = %d，想要 1", len(snapshots))
	}
	previous, err := os.ReadFile(filepath.Join(filepath.Dir(path), ".mdr-history", "all-features", snapshots[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(previous, original) {
		t.Error("历史快照不是保存前的原始字节")
	}
}

// .mdr-history keeps at most historyLimit copies, dropping the oldest.
func TestHistoryKeepsTenNewest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	const versions = historyLimit + 3
	for i := 0; i < versions; i++ {
		if _, _, err := writeDocument(path, fmt.Sprintf("version %d\n", i), "\n", encUTF8); err != nil {
			t.Fatalf("写入第 %d 版: %v", i, err)
		}
		// Snapshot names carry milliseconds: without a pause two writes can
		// collide into one file and the count would be short.
		time.Sleep(5 * time.Millisecond)
	}

	entries, err := os.ReadDir(filepath.Join(dir, ".mdr-history", "note"))
	if err != nil {
		t.Fatalf("历史目录: %v", err)
	}
	if len(entries) != historyLimit {
		t.Fatalf("快照数 = %d，想要 %d", len(entries), historyLimit)
	}
	got := map[string]bool{}
	for _, entry := range entries {
		raw, err := os.ReadFile(filepath.Join(dir, ".mdr-history", "note", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		got[string(raw)] = true
	}
	// Versions 0 and 1 fell off the end; 2 through historyLimit+1 remain.
	for i := 0; i < 2; i++ {
		if got[fmt.Sprintf("version %d\n", i)] {
			t.Errorf("最旧的第 %d 版还在", i)
		}
	}
	for i := 2; i <= historyLimit+1; i++ {
		if !got[fmt.Sprintf("version %d\n", i)] {
			t.Errorf("第 %d 版被误删", i)
		}
	}
}

func TestWriteDocumentRefusesEmptyPath(t *testing.T) {
	if _, _, err := writeDocument("", "x", "\n", encUTF8); err == nil {
		t.Fatal("空路径应当报错")
	}
}

// A read-only file says so in words a person can act on.
func TestWriteDocumentReportsReadOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "readonly.md")
	if err := os.WriteFile(path, []byte("守住\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(path, 0o644) })

	_, _, err := writeDocument(path, "改掉\n", "\n", encUTF8)
	if err == nil {
		t.Skip("这个环境里只读文件仍可写入（管理员/组策略），跳过")
	}
	if !strings.Contains(err.Error(), "只读") {
		t.Errorf("错误信息 = %q，想要提到只读", err)
	}
}

func TestUntitledFilesAreUnique(t *testing.T) {
	t.Setenv("AppData", t.TempDir())
	first, err := untitledFile()
	if err != nil {
		t.Fatal(err)
	}
	second, err := untitledFile()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatalf("两次新建拿到了同一个文件 %s", first)
	}
	for _, path := range []string{first, second} {
		if st, err := os.Stat(path); err != nil || st.Size() != 0 {
			t.Fatalf("%s 应当是空文件: %v", path, err)
		}
		if !isUntitled(path) {
			t.Errorf("%s 没有被认成未命名文档", path)
		}
	}
}

func TestSaveAsset(t *testing.T) {
	dir := t.TempDir()
	docPath := filepath.Join(dir, "doc.md")
	if err := os.WriteFile(docPath, []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	payload := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a}
	rel, err := (&Workspace{}).SaveAsset(docPath, ".PNG", base64.StdEncoding.EncodeToString(payload))
	if err != nil {
		t.Fatalf("SaveAsset: %v", err)
	}
	if !strings.HasPrefix(rel, "assets/image-") || !strings.HasSuffix(rel, ".png") {
		t.Errorf("返回的链接 = %q，想要 assets/image-….png", rel)
	}
	written, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("读回落盘的图片: %v", err)
	}
	if !bytes.Equal(written, payload) {
		t.Error("落盘的图片字节不对")
	}

	if _, err := (&Workspace{}).SaveAsset("", ".png", ""); err == nil {
		t.Error("没有保存的文档时应当拒绝")
	}
	if _, err := (&Workspace{}).SaveAsset(docPath, ".pdf", ""); err == nil {
		t.Error("非图片扩展名应当拒绝")
	}
	if _, err := (&Workspace{}).SaveAsset(docPath, ".png", "不是 base64"); err == nil {
		t.Error("坏掉的 base64 应当拒绝")
	}
}

func TestFilesAssetReturnsDataURL(t *testing.T) {
	dir := t.TempDir()
	image := filepath.Join(dir, "pic.png")
	raw := []byte{1, 2, 3, 4}
	if err := os.WriteFile(image, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	url, err := (Files{}).Asset(filepath.Join(dir, "doc.md"), "pic.png")
	if err != nil {
		t.Fatalf("Files.Asset: %v", err)
	}
	if !strings.HasPrefix(url, "data:image/png;base64,") {
		t.Fatalf("data URL = %q", url)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(url, "data:image/png;base64,"))
	if err != nil || !bytes.Equal(decoded, raw) {
		t.Errorf("base64 内容不对: %v", err)
	}
	if _, err := (Files{}).Asset(filepath.Join(dir, "doc.md"), "notes.txt"); err == nil {
		t.Error("非图片应当拒绝")
	}
}

// session.json is what brings the last run back: the shape has to stay readable.
func TestWriteSessionLayout(t *testing.T) {
	appDir := t.TempDir()
	t.Setenv("AppData", appDir)

	state := State{
		Windows: []WindowState{
			{ID: 1, Docs: []string{"d1", "d2"}, Active: "d2"},
			{ID: 2, Docs: nil},
			{ID: 3, Docs: []string{"d3"}, Active: "d3"},
		},
		Docs: []Doc{
			{ID: "d1", Path: `C:\docs\a.md`, Cursor: 12, Scroll: 0.5},
			{ID: "d2", Path: `C:\docs\b.md`, Untitled: true, Cursor: 3},
			{ID: "d3", Path: `C:\docs\c.md`, Scroll: 1},
		},
	}
	writeSession(state)

	raw, err := os.ReadFile(filepath.Join(appDir, "MDReader", "session.json"))
	if err != nil {
		t.Fatalf("session.json: %v", err)
	}
	var saved sessionFile
	if err := json.Unmarshal(raw, &saved); err != nil {
		t.Fatalf("session.json 不是合法 JSON: %v", err)
	}
	if len(saved.Windows) != 2 {
		t.Fatalf("窗口数 = %d，空窗口应当被跳过", len(saved.Windows))
	}
	first := saved.Windows[0]
	if got := first.Active; got != 1 {
		t.Errorf("活动标签下标 = %d，想要 1（d2）", got)
	}
	if len(first.Docs) != 2 || first.Docs[0].Path != `C:\docs\a.md` || first.Docs[1].Cursor != 3 {
		t.Errorf("第一个窗口的内容不对: %+v", first)
	}
	if !first.Docs[1].Untitled {
		t.Error("未命名标记丢了")
	}
	if got := saved.Windows[1].Active; got != 0 {
		t.Errorf("单标签窗口的活动下标 = %d，想要 0", got)
	}
}

func TestHelperFunctions(t *testing.T) {
	if got := humanSize(10 << 20); got != "10.0 MB" {
		t.Errorf("humanSize(10MB) = %q", got)
	}
	if got := humanSize(1024); got != "1 KB" {
		t.Errorf("humanSize(1KB) = %q", got)
	}
	if got := baseTitle(`C:\docs\readme.md`); got != "readme" {
		t.Errorf("baseTitle = %q", got)
	}
	if !samePath(`C:\Docs\A.md`, `c:/docs/a.md`) {
		t.Error("同一路径的不同写法没有被认成同一个文件")
	}
	if samePath(`C:\Docs\A.md`, `C:\Docs\B.md`) {
		t.Error("不同文件被认成了同一个")
	}
	if got := remove([]string{"a", "b", "c", "b"}, "b"); len(got) != 2 || got[0] != "a" || got[1] != "c" {
		t.Errorf("remove = %v", got)
	}
	if maxDocumentSize != 10<<20 {
		t.Errorf("maxDocumentSize = %d", maxDocumentSize)
	}
}

// Every encoding the status bar offers survives a write → read → write cycle
// byte for byte, with the BOM and CRLF the format implies.
func TestEncodingRoundTrip(t *testing.T) {
	const text = "# 编码测试\n\n中文、English、punctuation. \n"
	cases := []struct {
		name     string
		encoding string
		prefix   []byte
	}{
		{"UTF-8", encUTF8, nil},
		{"UTF-8 BOM", encUTF8BOM, []byte{0xEF, 0xBB, 0xBF}},
		{"GBK", encGBK, nil},
		{"UTF-16 LE", encUTF16LE, []byte{0xFF, 0xFE}},
		{"UTF-16 BE", encUTF16BE, []byte{0xFE, 0xFF}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "enc.md")
			if _, _, err := writeDocument(path, text, "\r\n", c.encoding); err != nil {
				t.Fatalf("写入: %v", err)
			}
			first, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if c.prefix != nil && !bytes.HasPrefix(first, c.prefix) {
				t.Fatalf("%s 缺少 BOM: % x", c.name, first[:min(4, len(first))])
			}
			doc, err := readDocument(path)
			if err != nil {
				t.Fatalf("读取: %v", err)
			}
			if doc.encoding != c.encoding {
				t.Errorf("识别成 %q，想要 %q", doc.encoding, c.encoding)
			}
			if doc.content != text {
				t.Errorf("解码后的文本不对: %q", doc.content)
			}
			if doc.eol != "\r\n" {
				t.Errorf("换行 = %q，想要 CRLF", doc.eol)
			}
			if _, _, err := writeDocument(path, doc.content, doc.eol, doc.encoding); err != nil {
				t.Fatalf("重新写入: %v", err)
			}
			again, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(first, again) {
				t.Error("读写一轮后字节变了")
			}
		})
	}
}

func TestWriteDocumentRejectsBadFormats(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := writeDocument(filepath.Join(dir, "a.md"), "x", "\n", "utf-32"); err == nil {
		t.Error("未知编码应当报错")
	}
	if _, _, err := writeDocument(filepath.Join(dir, "b.md"), "x", "\n\r", encUTF8); err == nil {
		t.Error("未知换行符应当报错")
	}
	// GBK has no emoji: saving must fail instead of writing a replacement.
	if _, _, err := writeDocument(filepath.Join(dir, "c.md"), "🙂", "\n", encGBK); err == nil {
		t.Error("GBK 无法表示的字符应当报错")
	}
}

func TestReadDocumentDetectsClassicMacEOL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mac.md")
	if err := os.WriteFile(path, []byte("one\rtwo\rthree\r"), 0o644); err != nil {
		t.Fatal(err)
	}
	doc, err := readDocument(path)
	if err != nil {
		t.Fatal(err)
	}
	if doc.eol != "\r" {
		t.Errorf("换行 = %q，想要 CR", doc.eol)
	}
	if doc.content != "one\ntwo\nthree\n" {
		t.Errorf("内容 = %q", doc.content)
	}
}

func TestSetFormatUpdatesTheDocument(t *testing.T) {
	t.Setenv("AppData", t.TempDir())
	doc := &Doc{ID: "d1", Path: filepath.Join(t.TempDir(), "a.md"), EOL: "\n", Encoding: encUTF8}
	s := &Workspace{docs: map[string]*Doc{"d1": doc}}

	if _, err := s.SetFormat("d1", "\r\n", encGBK); err != nil {
		t.Fatalf("SetFormat: %v", err)
	}
	if doc.EOL != "\r\n" || doc.Encoding != encGBK {
		t.Errorf("格式 = %q / %q", doc.EOL, doc.Encoding)
	}
	if !doc.Dirty {
		t.Error("切换格式后应当标为未保存")
	}
	if _, err := s.SetFormat("d1", "\n", "utf-32"); err == nil {
		t.Error("未知编码应当报错")
	}
	if _, err := s.SetFormat("d1", "\n\r", encUTF8); err == nil {
		t.Error("未知换行符应当报错")
	}
	if doc.Encoding != encGBK {
		t.Error("失败的切换不应改动文档")
	}
}
