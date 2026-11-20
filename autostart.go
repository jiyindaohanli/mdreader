//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const autostartTargetFile = "autostart-target.txt"

// autostartShortcut is the per-user Startup shortcut Windows runs at login.
// A shortcut is used instead of HKCU\...\Run: group policy or security
// software can deny writes there (it does on some machines), while the
// user's own Startup folder stays writable without administrator rights.
func autostartShortcut() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "MDReader.lnk"), nil
}

func autostartInstalled() bool {
	path, err := autostartShortcut()
	if err != nil {
		return false
	}
	_, err = os.Stat(path)
	return err == nil
}

// autostartCurrent reports whether the shortcut was last written for exe.
func autostartCurrent(exe string) bool {
	raw, err := os.ReadFile(filepath.Join(appData(), autostartTargetFile))
	return err == nil && strings.EqualFold(strings.TrimSpace(string(raw)), exe)
}

func setAutostart(exe string, on bool) error {
	path, err := autostartShortcut()
	if err != nil {
		return err
	}
	target := filepath.Join(appData(), autostartTargetFile)
	if !on {
		_ = os.Remove(path)
		_ = os.Remove(target)
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := createShortcut(path, exe); err != nil {
		return err
	}
	if err := os.MkdirAll(appData(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, []byte(exe), 0o644)
}

// createShortcut writes the .lnk with PowerShell's WScript.Shell: the shell
// link COM interfaces need more code than a small app should carry.
func createShortcut(path, exe string) error {
	script := fmt.Sprintf(
		"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%s'); $s.TargetPath = '%s'; $s.Arguments = '--hidden'; $s.WorkingDirectory = '%s'; $s.Save()",
		quotePowerShell(path), quotePowerShell(exe), quotePowerShell(filepath.Dir(exe)),
	)
	out, err := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).CombinedOutput()
	if err != nil {
		return fmt.Errorf("创建开机启动快捷方式失败: %v %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// quotePowerShell makes a path a single-quoted PowerShell string.
func quotePowerShell(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

// repairAutostart points an existing shortcut at the running exe, so a copy
// that was moved still starts at login.
func repairAutostart() {
	exe, err := currentExePath()
	if err != nil || !autostartInstalled() || autostartCurrent(exe) {
		return
	}
	_ = setAutostart(exe, true)
}
