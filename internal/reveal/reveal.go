package reveal

import (
	"fmt"
	"os"
	"path/filepath"
)

func Path(raw string) error {
	path := filepath.Clean(raw)
	if path == "" || path == "." {
		return fmt.Errorf("empty path")
	}
	if !filepath.IsAbs(path) {
		return fmt.Errorf("path must be absolute")
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	return reveal(path)
}
