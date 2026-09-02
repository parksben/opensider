package reveal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

var ErrNotFound = errors.New("file not found")

func Path(raw string) error {
	path := filepath.Clean(raw)
	if path == "" || path == "." {
		return fmt.Errorf("empty path")
	}
	if !filepath.IsAbs(path) {
		return fmt.Errorf("path must be absolute")
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%w: %s", ErrNotFound, path)
		}
		return err
	}
	return reveal(path)
}
