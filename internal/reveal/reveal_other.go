//go:build !darwin && !windows && !linux

package reveal

import "fmt"

func reveal(path string) error {
	return fmt.Errorf("reveal is not supported on this platform")
}

func openDir(path string) error {
	return fmt.Errorf("opening directories is not supported on this platform")
}
