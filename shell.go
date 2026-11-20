package main

// ShellStatus is what the page shows about the app's place in Explorer.
type ShellStatus struct {
	Supported      bool   `json:"supported"`
	Registered     bool   `json:"registered"`
	ExePath        string `json:"exePath"`
	RegisteredPath string `json:"registeredPath"`
}
