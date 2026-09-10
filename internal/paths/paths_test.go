package paths

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestClaudeACPPaths(t *testing.T) {
	dir := filepath.ToSlash(ClaudeACPDir())
	if !strings.HasSuffix(dir, ".opensider/runtime/claude-acp") {
		t.Fatalf("ClaudeACPDir %s", dir)
	}
	bin := filepath.ToSlash(ClaudeACPBinDir())
	if !strings.HasSuffix(bin, ".opensider/runtime/claude-acp/node_modules/.bin") {
		t.Fatalf("ClaudeACPBinDir %s", bin)
	}
}

func TestAgentSearchDirsIncludesClaudeACPBinDir(t *testing.T) {
	want := ClaudeACPBinDir()
	for _, dir := range AgentSearchDirs() {
		if dir == want {
			return
		}
	}
	t.Fatalf("AgentSearchDirs missing %s", want)
}
