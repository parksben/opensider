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

// Hermes 自带 ACP server：规范入口是 `hermes acp`，老安装没有子命令时退到
// 独立启动器 `hermes-acp`。
func TestHermesProfileLaunchesACP(t *testing.T) {
	p := ProfileByID("hermes")
	if p == nil {
		t.Fatal("missing hermes profile")
	}
	if len(p.Launches) != 2 {
		t.Fatalf("launches %+v", p.Launches)
	}
	if p.Launches[0].Command != "hermes-acp" {
		t.Fatalf("first launch %+v, want hermes-acp", p.Launches[0])
	}
	if p.Launches[1].Command != "hermes" || len(p.Launches[1].Args) != 1 || p.Launches[1].Args[0] != "acp" {
		t.Fatalf("fallback launch %+v, want hermes acp", p.Launches[1])
	}
	if !p.Caps.Plans || !p.Caps.Todos || p.Caps.Questions {
		t.Fatalf("caps %+v, want plans/todos on and questions off", p.Caps)
	}
	if !strings.Contains(p.LoginHint, "hermes setup") {
		t.Fatalf("login hint %q", p.LoginHint)
	}
}
