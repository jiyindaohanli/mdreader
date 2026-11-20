//go:build !windows

package main

// Starting at login is a Windows registry entry; the rest of the app still
// builds elsewhere for tests and tooling.

func autostartInstalled() bool { return false }

func autostartCurrent(string) bool { return false }

func setAutostart(string, bool) error { return nil }

func repairAutostart() {}
