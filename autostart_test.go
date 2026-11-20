//go:build windows

package main

import (
	"path/filepath"
	"testing"
)

func TestAutostartShortcut(t *testing.T) {
	t.Setenv("AppData", t.TempDir())
	exe := filepath.Join(t.TempDir(), "MDReader.exe")

	if autostartInstalled() {
		t.Error("干净环境里不应有开机启动项")
	}
	if err := setAutostart(exe, true); err != nil {
		t.Fatalf("创建快捷方式: %v", err)
	}
	if !autostartInstalled() {
		t.Error("快捷方式没有创建")
	}
	if !autostartCurrent(exe) {
		t.Error("记录的目标不是这个 exe")
	}
	path, err := autostartShortcut()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := filepath.Abs(path); err != nil || !filepath.IsAbs(path) {
		t.Errorf("快捷方式路径不是绝对路径: %q", path)
	}
	if err := setAutostart(exe, false); err != nil {
		t.Fatalf("移除快捷方式: %v", err)
	}
	if autostartInstalled() {
		t.Error("关掉后快捷方式还在")
	}
}
