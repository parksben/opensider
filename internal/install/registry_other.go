//go:build !windows

package install

func writeRegistry(manifestPath string) error {
	return nil
}

// deleteRegistry 只在 Windows 上做事。
func deleteRegistry() error {
	return nil
}
