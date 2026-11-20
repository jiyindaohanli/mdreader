package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

// Settings is what the page shows in its menu, and what the tray keeps.
type Settings struct {
	// CloseToTray keeps the app and its WebView2 alive when the window is
	// closed, so opening the next file is a handoff instead of a cold start.
	CloseToTray bool `json:"closeToTray"`
}

// settingsFile reads a missing field as the default: an older file, or none,
// gets close-to-tray on.
type settingsFile struct {
	CloseToTray *bool `json:"closeToTray"`
}

var settingsCache struct {
	sync.Mutex
	loaded bool
	value  Settings
}

func defaultSettings() Settings { return Settings{CloseToTray: true} }

func loadSettings() Settings {
	settingsCache.Lock()
	defer settingsCache.Unlock()
	if settingsCache.loaded {
		return settingsCache.value
	}
	settingsCache.loaded = true
	value := defaultSettings()
	if raw, err := os.ReadFile(filepath.Join(appData(), "preferences.json")); err == nil {
		var file settingsFile
		if json.Unmarshal(raw, &file) == nil && file.CloseToTray != nil {
			value.CloseToTray = *file.CloseToTray
		}
	}
	settingsCache.value = value
	return value
}

func storeSettings(value Settings) error {
	settingsCache.Lock()
	settingsCache.loaded = true
	settingsCache.value = value
	settingsCache.Unlock()
	if err := os.MkdirAll(appData(), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(appData(), "preferences.json"), raw, 0o644)
}

// resetSettingsCache is for tests: the real file is not read again.
func resetSettingsCache() {
	settingsCache.Lock()
	settingsCache.loaded = false
	settingsCache.value = Settings{}
	settingsCache.Unlock()
}

// Settings returns the preferences the menu toggles.
func (s *Workspace) Settings() Settings { return loadSettings() }

// SetCloseToTray remembers whether closing the window keeps the app running,
// and keeps the tray item in step.
func (s *Workspace) SetCloseToTray(on bool) error {
	if err := storeSettings(Settings{CloseToTray: on}); err != nil {
		return err
	}
	s.mu.Lock()
	item := s.trayItem
	s.mu.Unlock()
	if item != nil {
		item.SetChecked(on)
	}
	return nil
}

// QuitApp ends the app even when closing a window would only hide it.
func (s *Workspace) QuitApp() {
	s.mu.Lock()
	s.quitting = true
	s.mu.Unlock()
	mygo.App.Quit()
}

// shouldHideOnClose reports whether a close is a hide: the tray can bring the
// window back, and the reader has not asked to quit.
func (s *Workspace) shouldHideOnClose() bool {
	s.mu.Lock()
	ready, quitting := s.trayReady, s.quitting
	s.mu.Unlock()
	return ready && !quitting && loadSettings().CloseToTray
}
