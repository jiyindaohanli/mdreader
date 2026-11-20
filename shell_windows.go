//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// The portable exe registers itself for the current user only: no installer,
// no administrator rights. The keys are the ones mygo's installer writes
// (Software\Classes\<progID>, OpenWithProgids), so an installed copy and a
// portable one do not show up twice in "Open with".
const (
	// mygo's installer builds the ProgID from the identifier in mygo.config.ts,
	// keeping [0-9A-Za-z.]: cn.evegood.mdreader -> cn.evegood.mdreader.<ext>.
	// Registering the same ProgID keeps an installed copy and a portable one
	// from showing up twice in "Open with".
	shellProgIDBase = "cn.evegood.mdreader"
	shellAppName    = "MDReader"
	shellTypeName   = "Markdown 文档"
	shellVerb       = "MDReader"
	shellMarkerName = "shell-integration.json"
)

// shellExtensions are the types the context menu and "Open with" are added to.
var shellExtensions = []string{".md", ".markdown", ".mdown"}

// shellClassesRoot is Software\Classes. Tests point it at a scratch key.
var shellClassesRoot = `Software\Classes`

// shellMarker remembers whether the reader wants to be in the context menu:
// an unregister must survive the next launch.
type shellMarker struct {
	Enabled      bool   `json:"enabled"`
	Applications string `json:"applications"`
}

// ShellStatus reports whether this exe is registered in Explorer's "Open with"
// list and the .md context menu.
func (s *Workspace) ShellStatus() (ShellStatus, error) { return shellStatus() }

// RegisterShell adds the running exe to "Open with" and the .md right-click
// menu for the current user. No installer and no administrator rights.
func (s *Workspace) RegisterShell() (ShellStatus, error) { return registerShell() }

// UnregisterShell undoes RegisterShell, and remembers not to redo it on start.
func (s *Workspace) UnregisterShell() (ShellStatus, error) { return unregisterShell() }

// autoRegisterShell puts a freshly downloaded exe into the context menu on its
// first run, and repairs the paths when the exe was moved. A marker saying the
// reader opted out stops it.
func (s *Workspace) autoRegisterShell() {
	exe, err := currentExePath()
	if err != nil {
		return
	}
	marker, known := readShellMarker()
	if known && !marker.Enabled {
		return
	}
	if status, err := shellStatus(); err == nil && status.Registered {
		return
	}
	if err := registerShellKeys(exe); err != nil {
		log.Printf("无法加入右键菜单: %v", err)
		return
	}
	if err := writeShellMarker(shellMarker{Enabled: true, Applications: filepath.Base(exe)}); err != nil {
		log.Printf("无法记录右键菜单状态: %v", err)
	}
	notifyShell()
}

func currentExePath() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	return filepath.Clean(path), nil
}

func shellCommand(exe string) string { return `"` + exe + `" "%1"` }

func shellProgID(ext string) string { return shellProgIDBase + ext }

func registerShell() (ShellStatus, error) {
	exe, err := currentExePath()
	if err != nil {
		return ShellStatus{}, err
	}
	if err := registerShellKeys(exe); err != nil {
		return ShellStatus{Supported: true, ExePath: exe}, err
	}
	if err := writeShellMarker(shellMarker{Enabled: true, Applications: filepath.Base(exe)}); err != nil {
		return ShellStatus{Supported: true, ExePath: exe}, err
	}
	notifyShell()
	return shellStatus()
}

func unregisterShell() (ShellStatus, error) {
	exe, err := currentExePath()
	if err != nil {
		return ShellStatus{}, err
	}
	if err := unregisterShellKeys(exe); err != nil {
		return ShellStatus{Supported: true, ExePath: exe}, err
	}
	if err := writeShellMarker(shellMarker{Enabled: false}); err != nil {
		return ShellStatus{Supported: true, ExePath: exe}, err
	}
	notifyShell()
	return shellStatus()
}

// registerShellKeys writes the per-user registration for exe:
//
//	Software\Classes\<progID>                  the file type and its open command
//	Software\Classes\.md\OpenWithProgids      makes it an option in "Open with"
//	Software\Classes\Applications\<exe>        names the app in that list
//	Software\Classes\SystemFileAssociations\  the "用 MDReader 打开" entry
func registerShellKeys(exe string) error {
	// A renamed exe leaves the old Applications entry behind: remove the one
	// this app wrote last time.
	if marker, known := readShellMarker(); known && marker.Applications != "" && marker.Applications != filepath.Base(exe) {
		if err := deleteTree(shellClassesRoot + `\Applications\` + marker.Applications); err != nil {
			return err
		}
	}
	command := shellCommand(exe)
	icon := exe + ",0"
	for _, ext := range shellExtensions {
		id := shellProgID(ext)
		class := shellClassesRoot + `\` + id
		if err := setString(class, "", shellTypeName); err != nil {
			return err
		}
		if err := setString(class+`\DefaultIcon`, "", icon); err != nil {
			return err
		}
		if err := setString(class+`\shell\open\command`, "", command); err != nil {
			return err
		}
		if err := setString(shellClassesRoot+`\`+ext+`\OpenWithProgids`, id, ""); err != nil {
			return err
		}
		// Windows 11 keeps legacy verbs under "Show more options"; the
		// modern "Open with" entry comes from OpenWithProgids above.
		verb := shellClassesRoot + `\SystemFileAssociations\` + ext + `\shell\` + shellVerb
		if err := setString(verb, "", "用 "+shellAppName+" 打开"); err != nil {
			return err
		}
		if err := setString(verb, "Icon", icon); err != nil {
			return err
		}
		if err := setString(verb+`\command`, "", command); err != nil {
			return err
		}
	}
	app := shellClassesRoot + `\Applications\` + filepath.Base(exe)
	if err := setString(app, "FriendlyAppName", shellAppName); err != nil {
		return err
	}
	if err := setString(app, "DefaultIcon", icon); err != nil {
		return err
	}
	if err := setString(app+`\shell\open\command`, "", command); err != nil {
		return err
	}
	for _, ext := range shellExtensions {
		if err := setString(app+`\SupportedTypes`, ext, ""); err != nil {
			return err
		}
	}
	return nil
}

func unregisterShellKeys(exe string) error {
	marker, _ := readShellMarker()
	for _, ext := range shellExtensions {
		id := shellProgID(ext)
		if err := deleteTree(shellClassesRoot + `\` + id); err != nil {
			return err
		}
		if err := deleteValue(shellClassesRoot+`\`+ext+`\OpenWithProgids`, id); err != nil {
			return err
		}
		if err := deleteTree(shellClassesRoot + `\SystemFileAssociations\` + ext + `\shell\` + shellVerb); err != nil {
			return err
		}
	}
	names := []string{filepath.Base(exe)}
	if marker.Applications != "" && marker.Applications != names[0] {
		names = append(names, marker.Applications)
	}
	for _, name := range names {
		if err := deleteTree(shellClassesRoot + `\Applications\` + name); err != nil {
			return err
		}
	}
	return nil
}

func shellStatus() (ShellStatus, error) {
	exe, err := currentExePath()
	if err != nil {
		return ShellStatus{}, err
	}
	status := ShellStatus{Supported: true, ExePath: exe}
	if marker, known := readShellMarker(); known && !marker.Enabled {
		return status, nil
	}
	command, err := getString(shellClassesRoot+`\`+shellProgID(".md")+`\shell\open\command`, "")
	if notExist(err) {
		return status, nil
	}
	if err != nil {
		return status, err
	}
	status.RegisteredPath = commandExe(command)
	matches := status.RegisteredPath != "" &&
		strings.EqualFold(filepath.Clean(status.RegisteredPath), exe)
	status.Registered = matches && shellKeysComplete(exe)
	return status, nil
}

// shellKeysComplete reports whether every key registerShellKeys writes is
// still there and names the current exe. A partial registration (an installer
// removed, the exe moved, a key deleted by hand) is repaired on the next start.
func shellKeysComplete(exe string) bool {
	app := shellClassesRoot + `\Applications\` + filepath.Base(exe)
	if _, err := getString(app, "FriendlyAppName"); err != nil {
		return false
	}
	for _, ext := range shellExtensions {
		if _, err := getString(shellClassesRoot+`\`+ext+`\OpenWithProgids`, shellProgID(ext)); err != nil {
			return false
		}
		if _, err := getString(shellClassesRoot+`\SystemFileAssociations\`+ext+`\shell\`+shellVerb+`\command`, ""); err != nil {
			return false
		}
	}
	return true
}

// commandExe is the program a shell command runs: `"C:\...\MDReader.exe" "%1"`.
func commandExe(command string) string {
	command = strings.TrimSpace(command)
	if strings.HasPrefix(command, `"`) {
		if end := strings.Index(command[1:], `"`); end >= 0 {
			return command[1 : end+1]
		}
		return ""
	}
	if end := strings.IndexAny(command, " \t"); end > 0 {
		return command[:end]
	}
	return command
}

func shellMarkerPath() string { return filepath.Join(appData(), shellMarkerName) }

func readShellMarker() (shellMarker, bool) {
	raw, err := os.ReadFile(shellMarkerPath())
	if err != nil {
		return shellMarker{}, false
	}
	var marker shellMarker
	if json.Unmarshal(raw, &marker) != nil {
		return shellMarker{}, false
	}
	return marker, true
}

func writeShellMarker(marker shellMarker) error {
	if err := os.MkdirAll(appData(), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(marker, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(shellMarkerPath(), raw, 0o644)
}

// notifyShell tells Explorer that file associations changed.
func notifyShell() {
	const (
		shcneAssocChanged = 0x08000000
		shcnfIDList       = 0x0000
	)
	proc := windows.NewLazySystemDLL("shell32.dll").NewProc("SHChangeNotify")
	proc.Call(shcneAssocChanged, shcnfIDList, 0, 0)
}

// ---- registry helpers ----

func setString(path, name, value string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.WRITE)
	if err != nil {
		return err
	}
	defer key.Close()
	return key.SetStringValue(name, value)
}

func getString(path, name string) (string, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer key.Close()
	value, _, err := key.GetStringValue(name)
	return value, err
}

func deleteValue(path, name string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.WRITE)
	if err != nil {
		if notExist(err) {
			return nil
		}
		return err
	}
	defer key.Close()
	if err := key.DeleteValue(name); err != nil && !notExist(err) {
		return err
	}
	return nil
}

// deleteTree removes a key and everything under it; a key that is not there is
// not an error, so unregistering twice is harmless.
func deleteTree(path string) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, path, registry.READ|registry.WRITE)
	if err != nil {
		if notExist(err) {
			return nil
		}
		return err
	}
	names, err := key.ReadSubKeyNames(-1)
	key.Close()
	if err != nil {
		return err
	}
	for _, name := range names {
		if err := deleteTree(path + `\` + name); err != nil {
			return err
		}
	}
	if err := registry.DeleteKey(registry.CURRENT_USER, path); err != nil && !notExist(err) {
		return err
	}
	return nil
}

// notExist covers both windows errors the registry returns for a missing key:
// the key itself, or a parent that is missing too.
func notExist(err error) bool {
	return errors.Is(err, registry.ErrNotExist) || errors.Is(err, syscall.ERROR_PATH_NOT_FOUND)
}
