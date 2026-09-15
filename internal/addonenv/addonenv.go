package addonenv

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/parksben/opensider/internal/paths"
)

// Prepare pins TMPDIR for one Agent and, on macOS, signs extracted native
// addons so Gatekeeper does not re-prompt on every Chrome-spawned launch.
// The returned stop function ends the background sweeper.
func Prepare(agentID, command string) (tmpdir string, stop func()) {
	id := strings.TrimSpace(agentID)
	tmpdir = paths.AgentNativeDir(id)
	if err := os.MkdirAll(tmpdir, 0o755); err != nil {
		return "", func() {}
	}
	return tmpdir, startSweep(command, tmpdir)
}

func sweepRoots(command, tmpdir string) []string {
	var roots []string
	add := func(dir string) {
		if dir == "" {
			return
		}
		if st, err := os.Stat(dir); err == nil && st.IsDir() {
			roots = append(roots, dir)
		}
	}
	add(tmpdir)
	if command != "" {
		add(filepath.Dir(command))
		add(filepath.Join(filepath.Dir(command), "..", "node_modules"))
	}
	add(filepath.Join(paths.Home(), ".opencode", "node_modules"))
	return roots
}
