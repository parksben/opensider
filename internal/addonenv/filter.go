package addonenv

import (
	"os"
	"path/filepath"
	"strings"
)

const maxSignBytes = 8 << 20

func shouldSign(path string, size int64) bool {
	if size <= 0 || size > maxSignBytes {
		return false
	}
	name := strings.ToLower(filepath.Base(path))
	switch {
	case strings.HasSuffix(name, ".node"), strings.HasSuffix(name, ".dylib"):
		return true
	case strings.HasPrefix(name, ".") && strings.Contains(name, ".node"):
		return true
	default:
		return false
	}
}

func walkSignable(roots []string, fn func(path string)) {
	seen := map[string]bool{}
	for _, root := range roots {
		if root == "" {
			continue
		}
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				return nil
			}
			if seen[path] || !shouldSign(path, info.Size()) {
				return nil
			}
			seen[path] = true
			fn(path)
			return nil
		})
	}
}
