//go:build linux

package reveal

import (
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
)

func reveal(path string) error {
	uri := "file://" + (&url.URL{Path: path}).EscapedPath()
	cmd := exec.Command(
		"dbus-send",
		"--session",
		"--dest=org.freedesktop.FileManager1",
		"--type=method_call",
		"/org/freedesktop/FileManager1",
		"org.freedesktop.FileManager1.ShowItems",
		"array:string:"+uri,
		"string:",
	)
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Run(); err == nil {
		return nil
	}
	dir := path
	if st, err := os.Stat(path); err == nil && !st.IsDir() {
		dir = filepath.Dir(path)
	}
	open := exec.Command("xdg-open", dir)
	open.Stdin = nil
	open.Stdout = nil
	open.Stderr = nil
	return open.Run()
}
