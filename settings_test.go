package main

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsDefaultAndRoundTrip(t *testing.T) {
	t.Setenv("AppData", t.TempDir())
	resetSettingsCache()
	t.Cleanup(resetSettingsCache)

	if !loadSettings().CloseToTray {
		t.Error("没有设置文件时，关闭应收进托盘")
	}
	if err := storeSettings(Settings{CloseToTray: false}); err != nil {
		t.Fatalf("storeSettings: %v", err)
	}
	resetSettingsCache()
	if loadSettings().CloseToTray {
		t.Error("关掉的设置没有保存")
	}
	if _, err := os.Stat(filepath.Join(appData(), "preferences.json")); err != nil {
		t.Errorf("preferences.json: %v", err)
	}

	// A file without the field, as an older version would write it, means the
	// default: on.
	if err := os.WriteFile(filepath.Join(appData(), "preferences.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSettingsCache()
	if !loadSettings().CloseToTray {
		t.Error("缺少 closeToTray 字段时应当默认开")
	}
}

func TestTrayIconIsA32pxPNG(t *testing.T) {
	icon := trayIcon()
	if len(icon) == 0 {
		t.Fatal("没有生成托盘图标")
	}
	img, err := png.Decode(bytes.NewReader(icon))
	if err != nil {
		t.Fatalf("不是 PNG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 32 || b.Dy() != 32 {
		t.Errorf("尺寸 = %dx%d，想要 32x32", b.Dx(), b.Dy())
	}
}
