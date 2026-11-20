//go:build !windows

package main

// Explorer integration is a Windows feature; the rest of the app builds
// elsewhere so that tests and tooling still compile.

func (s *Workspace) ShellStatus() (ShellStatus, error) { return ShellStatus{}, nil }

func (s *Workspace) RegisterShell() (ShellStatus, error) { return ShellStatus{}, nil }

func (s *Workspace) UnregisterShell() (ShellStatus, error) { return ShellStatus{}, nil }

func (s *Workspace) autoRegisterShell() {}
