//go:build windows

package main

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows/registry"
)

// scratchShell points the registration at a throwaway key and a throwaway
// AppData, so a test never touches the real Explorer entries or session file.
func scratchShell(t *testing.T) {
	t.Helper()
	previous := shellClassesRoot
	shellClassesRoot = `Software\MDReaderTest\Classes`
	t.Setenv("AppData", t.TempDir())
	t.Cleanup(func() {
		if err := deleteTree(`Software\MDReaderTest`); err != nil {
			t.Errorf("清理测试注册表: %v", err)
		}
		shellClassesRoot = previous
	})
}

func TestRegisterShellWritesExplorerKeys(t *testing.T) {
	scratchShell(t)
	exe, err := currentExePath()
	if err != nil {
		t.Fatal(err)
	}

	status, err := (&Workspace{}).RegisterShell()
	if err != nil {
		t.Fatalf("RegisterShell: %v", err)
	}
	if !status.Supported || !status.Registered {
		t.Fatalf("状态 = %+v，想要已注册", status)
	}
	if !strings.EqualFold(status.RegisteredPath, exe) {
		t.Errorf("注册的路径 = %q，想要 %q", status.RegisteredPath, exe)
	}

	command, err := getString(shellClassesRoot+`\`+shellProgID(".md")+`\shell\open\command`, "")
	if err != nil {
		t.Fatalf("读打开命令: %v", err)
	}
	if want := `"` + exe + `" "%1"`; command != want {
		t.Errorf("打开命令 = %q，想要 %q", command, want)
	}

	for _, ext := range []string{".md", ".markdown", ".mdown"} {
		if _, err := getString(shellClassesRoot+`\`+ext+`\OpenWithProgids`, shellProgID(ext)); err != nil {
			t.Errorf("%s 没有进入打开方式: %v", ext, err)
		}
		if _, err := getString(shellClassesRoot+`\SystemFileAssociations\`+ext+`\shell\MDReader`, ""); err != nil {
			t.Errorf("%s 没有右键项: %v", ext, err)
		}
	}

	app := shellClassesRoot + `\Applications\` + filepath.Base(exe)
	if name, err := getString(app, "FriendlyAppName"); err != nil || name != "MDReader" {
		t.Errorf("FriendlyAppName = %q, %v", name, err)
	}
	if _, err := getString(app+`\SupportedTypes`, ".md"); err != nil {
		t.Errorf("SupportedTypes 缺 .md: %v", err)
	}
	if icon, err := getString(shellClassesRoot+`\`+shellProgID(".md")+`\DefaultIcon`, ""); err != nil || icon != exe+",0" {
		t.Errorf("DefaultIcon = %q, %v", icon, err)
	}

	marker, ok := readShellMarker()
	if !ok || !marker.Enabled || marker.Applications != filepath.Base(exe) {
		t.Errorf("标记文件 = %+v（存在=%v）", marker, ok)
	}
}

func TestUnregisterShellRemovesEverything(t *testing.T) {
	scratchShell(t)
	if _, err := (&Workspace{}).RegisterShell(); err != nil {
		t.Fatal(err)
	}
	status, err := (&Workspace{}).UnregisterShell()
	if err != nil {
		t.Fatalf("UnregisterShell: %v", err)
	}
	if status.Registered {
		t.Errorf("取消后仍显示已注册: %+v", status)
	}

	exe, _ := currentExePath()
	gone := map[string]string{
		"文件类型":         shellClassesRoot + `\` + shellProgID(".md"),
		"Applications": shellClassesRoot + `\Applications\` + filepath.Base(exe),
		"右键项":          shellClassesRoot + `\SystemFileAssociations\.md\shell\MDReader`,
	}
	for name, path := range gone {
		if _, err := registry.OpenKey(registry.CURRENT_USER, path, registry.READ); !notExist(err) {
			t.Errorf("%s 还在: %v", name, err)
		}
	}
	for _, ext := range []string{".md", ".markdown", ".mdown"} {
		if _, err := getString(shellClassesRoot+`\`+ext+`\OpenWithProgids`, shellProgID(ext)); !errors.Is(err, registry.ErrNotExist) {
			t.Errorf("%s 的 OpenWithProgids 值还在: %v", ext, err)
		}
	}
	marker, ok := readShellMarker()
	if !ok || marker.Enabled {
		t.Errorf("标记文件应当记录已取消: %+v（存在=%v）", marker, ok)
	}

	// Unregistering twice is not an error: the menu item may be clicked again.
	if _, err := (&Workspace{}).UnregisterShell(); err != nil {
		t.Errorf("第二次取消: %v", err)
	}
}

func TestAutoRegisterShellOnFirstRun(t *testing.T) {
	scratchShell(t)
	(&Workspace{}).autoRegisterShell()

	status, err := (&Workspace{}).ShellStatus()
	if err != nil {
		t.Fatal(err)
	}
	if !status.Registered {
		t.Fatalf("首次运行没有加入右键菜单: %+v", status)
	}
}

func TestAutoRegisterShellHonoursOptOut(t *testing.T) {
	scratchShell(t)
	if err := writeShellMarker(shellMarker{Enabled: false}); err != nil {
		t.Fatal(err)
	}
	(&Workspace{}).autoRegisterShell()

	status, err := (&Workspace{}).ShellStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Registered {
		t.Error("用户取消过，启动时又加回来了")
	}
	if _, err := getString(shellClassesRoot+`\`+shellProgID(".md")+`\shell\open\command`, ""); !errors.Is(err, registry.ErrNotExist) {
		t.Errorf("取消后仍写入了注册表: %v", err)
	}
}

func TestShellStatusNoticesAMovedExe(t *testing.T) {
	scratchShell(t)
	if _, err := (&Workspace{}).RegisterShell(); err != nil {
		t.Fatal(err)
	}
	// A command that points at another copy: the menu entry goes stale.
	if err := setString(shellClassesRoot+`\`+shellProgID(".md")+`\shell\open\command`, "", `"D:\old\MDReader.exe" "%1"`); err != nil {
		t.Fatal(err)
	}
	status, err := (&Workspace{}).ShellStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.Registered {
		t.Error("指向旧路径的注册被当成了已注册")
	}
	if status.RegisteredPath != `D:\old\MDReader.exe` {
		t.Errorf("RegisteredPath = %q", status.RegisteredPath)
	}
}

func TestCommandExe(t *testing.T) {
	cases := []struct{ command, want string }{
		{`"C:\Program Files\MDReader\MDReader.exe" "%1"`, `C:\Program Files\MDReader\MDReader.exe`},
		{`C:\tools\MDReader.exe "%1"`, `C:\tools\MDReader.exe`},
		{`"C:\only.exe"`, `C:\only.exe`},
		{``, ``},
	}
	for _, c := range cases {
		if got := commandExe(c.command); got != c.want {
			t.Errorf("commandExe(%q) = %q，想要 %q", c.command, got, c.want)
		}
	}
}
