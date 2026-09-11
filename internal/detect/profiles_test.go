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

// Codex 和 Claude 一样：本体不带 ACP，第一位要试 runtime 里那份适配器，
// 否则 install 自动装好的适配器不会被探测到。
func TestCodexProfilePrefersPrefixBin(t *testing.T) {
	p := ProfileByID("codex")
	if p == nil {
		t.Fatal("missing codex profile")
	}
	want := filepath.Join(paths.CodexACPBinDir(), "codex-acp")
	if len(p.Launches) == 0 || p.Launches[0].Command != want {
		t.Fatalf("first launch %q, want %q", p.Launches[0].Command, want)
	}
	if !strings.Contains(p.LoginHint, "OpenSider install") || !strings.Contains(p.LoginHint, "codex") {
		t.Fatalf("login hint %q", p.LoginHint)
	}
}
