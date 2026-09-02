//go:build !windows

package install

func writeRegistry(manifestPath string) error {
	return nil
}
