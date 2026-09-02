//go:build !darwin && !windows && !linux

package pick

import "fmt"

func dialog(mode Mode) ([]string, error) {
	return nil, fmt.Errorf("file picker is not supported on this platform")
}
