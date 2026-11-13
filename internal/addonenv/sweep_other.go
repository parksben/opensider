//go:build !darwin

package addonenv

func prepareRuntime(agentID string) {}

func startSweep(command, tmpdir string) func() {
	return func() {}
}
