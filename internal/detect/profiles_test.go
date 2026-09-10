package detect

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/parksben/opensider/internal/paths"
)

func TestClaudeProfilePrefersPrefixBin(t *testing.T) {
	p := ProfileByID("claude")
	if p == nil {
		t.Fatal("missing claude profile")
	}
	want := filepath.Join(paths.ClaudeACPBinDir(), "claude-agent-acp")
	if len(p.Launches) == 0 || p.Launches[0].Command != want {
		t.Fatalf("first launch %q, want %q", p.Launches[0].Command, want)
	}
	if !strings.Contains(p.LoginHint, "OpenSider install") || !strings.Contains(p.LoginHint, "claude") {
		t.Fatalf("login hint %q", p.LoginHint)
	}
}
