package main

import (
	"log"
	"os"
	"strings"

	"github.com/egoist/mygo"
)

func main() {
	// `MDReader.exe --register` joins the Explorer menus without opening a
	// window, which is how a fresh copy gets a right-click entry before it has
	// ever been run: the .cmd next to it calls this.
	if handled, code := handleShellArgs(os.Args[1:]); handled {
		os.Exit(code)
	}

	// A second launch, from Explorer or the command line, hands its files to
	// the window that is already open.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	// The app draws its own title bar, and every command lives in a shortcut, a
	// context menu or the toolbar: no menu bar.
	mygo.App.SetMenu(nil)

	mygo.Bind(Files{}, workspace)
	mygo.App.OnOpenFile(func(path string) { workspace.queueFile(path) })
	// A quit from the tray, the menu or the OS ends the app for real:
	// the windows must not turn their close into a hide.
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		workspace.mu.Lock()
		workspace.quitting = true
		workspace.mu.Unlock()
	})

	mygo.App.WhenReady(func() {
		startTray()

		// A single exe is run without an installer, so it registers its own
		// "Open with" and .md context menu entries on first run. Not while
		// developing: that would point Explorer at a build in .mygo/.
		if !mygo.IsDev() {
			workspace.autoRegisterShell()
		}

		workspace.mu.Lock()
		hasFiles := len(workspace.startup) > 0
		workspace.mu.Unlock()

		if hasFiles {
			workspace.OpenExternalFiles()
		} else if !restoreSession() {
			workspace.createStartupWindow()
		}
		go watchExternal()
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

// handleShellArgs runs the windowless registry commands, and reports whether
// it did: true means main should exit with the code it returns.
func handleShellArgs(args []string) (handled bool, code int) {
	for _, arg := range args {
		switch strings.ToLower(strings.TrimSpace(arg)) {
		case "--register", "-register", "/register":
			if _, err := workspace.RegisterShell(); err != nil {
				log.Printf("注册右键菜单失败: %v", err)
				return true, 1
			}
			return true, 0
		case "--unregister", "-unregister", "/unregister":
			if _, err := workspace.UnregisterShell(); err != nil {
				log.Printf("取消右键菜单失败: %v", err)
				return true, 1
			}
			return true, 0
		}
	}
	return false, 0
}
