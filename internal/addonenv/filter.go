package addonenv

import (
	"os"
	"path/filepath"
	"strings"
)

// 64MB：Hermes 的 Python venv 里有 30MB 的 .so（nemo_relay），8MB 的旧上限
// 会把它漏掉；Gatekeeper 对任何未签名的 Mach-O 都会拦，跟体积无关。
const maxSignBytes = 64 << 20

func shouldSign(path string, size int64) bool {
	if size <= 0 || size > maxSignBytes {
		return false
	}
	name := strings.ToLower(filepath.Base(path))
	switch {
	case strings.HasSuffix(name, ".node"),
		strings.HasSuffix(name, ".dylib"),
		strings.HasSuffix(name, ".so"):
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
			if err != nil || info == nil || info.IsDir() || !info.Mode().IsRegular() {
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
