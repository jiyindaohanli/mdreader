package main

import (
	"log"

	"github.com/egoist/mygo"
)

func main() {
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

	mygo.App.WhenReady(func() {
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
