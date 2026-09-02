//go:build darwin

package reveal

import "os/exec"

func reveal(path string) error {
	cmd := exec.Command("open", "-R", path)
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}
