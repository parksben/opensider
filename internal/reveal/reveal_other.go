//go:build !darwin && !windows && !linux

package reveal

import "fmt"

func reveal(path string) error {
	return fmt.Errorf("reveal is not supported on this platform")
}
