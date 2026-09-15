//go:build !darwin

package addonenv

func startSweep(command, tmpdir string) func() {
	return func() {}
}
