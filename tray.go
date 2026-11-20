package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"

	"github.com/egoist/mygo"
)

// startTray puts MDReader in the notification area: the only way back to a
// window that "close" only hides, and the place to quit for real.
func startTray() {
	settings := loadSettings()
	open := &mygo.MenuItem{
		ID:    "open",
		Label: "打开 MDReader",
		Click: func(*mygo.MenuItem, *mygo.Window) { workspace.showWindow() },
	}
	keep := &mygo.MenuItem{
		ID:      "close-to-tray",
		Label:   "关闭时收进托盘",
		Type:    mygo.MenuItemCheckbox,
		Checked: settings.CloseToTray,
		Click: func(item *mygo.MenuItem, _ *mygo.Window) {
			if err := workspace.SetCloseToTray(item.IsChecked()); err != nil {
				log.Printf("无法保存「关闭时收进托盘」: %v", err)
			}
		},
	}
	login := &mygo.MenuItem{
		ID:      "start-at-login",
		Label:   "开机启动（隐藏到托盘）",
		Type:    mygo.MenuItemCheckbox,
		Checked: autostartInstalled(),
		Click: func(item *mygo.MenuItem, _ *mygo.Window) {
			if err := workspace.SetStartAtLogin(item.IsChecked()); err != nil {
				log.Printf("无法设置开机启动: %v", err)
			}
		},
	}
	quit := &mygo.MenuItem{
		ID:    "quit",
		Label: "退出 MDReader",
		Click: func(*mygo.MenuItem, *mygo.Window) { workspace.QuitApp() },
	}
	menu := mygo.NewMenu([]*mygo.MenuItem{
		open,
		{Type: mygo.MenuItemSeparator},
		keep,
		login,
		{Type: mygo.MenuItemSeparator},
		quit,
	})

	tray, err := mygo.NewTray(mygo.TrayOptions{
		ID:      "main",
		Icon:    trayIcon(),
		ToolTip: "MDReader",
		Menu:    menu,
	})
	if err != nil {
		// Without a tray a hidden window could never come back, so closing
		// keeps quitting instead.
		log.Printf("无法创建托盘图标，关闭窗口将直接退出: %v", err)
		return
	}
	tray.OnClick(func() { workspace.showWindow() })

	workspace.mu.Lock()
	workspace.tray = tray
	workspace.trayItem = keep
	workspace.trayLogin = login
	workspace.trayReady = true
	workspace.mu.Unlock()
}

// showWindow brings back a hidden window, or makes one when none is left.
func (s *Workspace) showWindow() {
	s.mu.Lock()
	active := s.active
	order := append([]int{}, s.order...)
	s.mu.Unlock()
	if native := s.nativeWindow(active); native != nil {
		if !native.IsVisible() {
			native.Show()
		}
		native.Focus()
		return
	}
	for _, id := range order {
		if native := s.nativeWindow(id); native != nil {
			if !native.IsVisible() {
				native.Show()
			}
			native.Focus()
			return
		}
	}
	s.createStartupWindow()
}

// trayIcon draws a 32x32 blue tile with a white M, so the icon is legible on
// light and dark taskbars and is not the artwork the window icon uses.
func trayIcon() []byte {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	blue := color.RGBA{0x00, 0x7A, 0xFF, 0xFF}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if insideRounded(float64(x)+0.5, float64(y)+0.5, size, 7) {
				img.SetRGBA(x, y, blue)
			}
		}
	}
	white := color.RGBA{0xFF, 0xFF, 0xFF, 0xFF}
	for _, line := range [][4]float64{
		{9, 23, 9, 9.5},
		{9, 9.5, 16, 18.5},
		{16, 18.5, 23, 9.5},
		{23, 9.5, 23, 23},
	} {
		stroke(img, line[0], line[1], line[2], line[3], 2.2, white)
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil
	}
	return buf.Bytes()
}

func insideRounded(px, py float64, size int, radius float64) bool {
	if px < 0 || py < 0 || px > float64(size) || py > float64(size) {
		return false
	}
	cx := math.Min(math.Max(px, radius), float64(size)-radius)
	cy := math.Min(math.Max(py, radius), float64(size)-radius)
	dx, dy := px-cx, py-cy
	return dx*dx+dy*dy <= radius*radius
}

// stroke paints a line with round ends, for the icon's M.
func stroke(img *image.RGBA, x1, y1, x2, y2, width float64, c color.RGBA) {
	minX := int(math.Floor(math.Min(x1, x2) - width))
	maxX := int(math.Ceil(math.Max(x1, x2) + width))
	minY := int(math.Floor(math.Min(y1, y2) - width))
	maxY := int(math.Ceil(math.Max(y1, y2) + width))
	for y := minY; y <= maxY; y++ {
		for x := minX; x <= maxX; x++ {
			if x < 0 || y < 0 || x >= img.Bounds().Dx() || y >= img.Bounds().Dy() {
				continue
			}
			if distanceToSegment(float64(x)+0.5, float64(y)+0.5, x1, y1, x2, y2) <= width/2 {
				img.SetRGBA(x, y, c)
			}
		}
	}
}

func distanceToSegment(px, py, x1, y1, x2, y2 float64) float64 {
	dx, dy := x2-x1, y2-y1
	length := dx*dx + dy*dy
	if length == 0 {
		return math.Hypot(px-x1, py-y1)
	}
	t := ((px-x1)*dx + (py-y1)*dy) / length
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(px-(x1+t*dx), py-(y1+t*dy))
}
