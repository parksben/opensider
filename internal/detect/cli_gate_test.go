package detect

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/parksben/opensider/internal/paths"
)

func makeExecutable(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

// 只剩适配器（CLI 本体已被用户卸载）时不列名；本体回到用户自己的目录后才列名。
// 适配器 prefix 里放一个与本体同名的文件不能顶替本体——codex-acp 内嵌 codex 的坑
// 正是这样。
func TestResolveLaunchHidesAgentWhoseHostCLIIsGone(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	// PATH 清空：只让版本管理器目录说话，免得宿主机的 PATH 把适配器 prefix 或真的
	// CLI 带进来，让断言不确定。
	t.Setenv("PATH", "")

	const cliName = "opensider-gate-test-cli"
	adapter := filepath.Join(paths.ClaudeACPBinDir(), "claude-agent-acp")
	makeExecutable(t, adapter)
	makeExecutable(t, filepath.Join(paths.ClaudeACPBinDir(), cliName))

	profile := AgentProfile{
		ID:       "gate-test",
		Name:     "Gate Test",
		CLINames: []string{cliName},
		Launches: []Launch{{Command: adapter}},
	}

	if hit := resolveLaunch(profile, 0, map[string]bool{}); hit != nil {
		t.Fatalf("adapter-only agent must be hidden, got %+v", hit)
	}

	makeExecutable(t, filepath.Join(home, ".local", "bin", cliName))
	if hit := resolveLaunch(profile, 0, map[string]bool{}); hit == nil {
		t.Fatal("agent must be listed once its CLI is back on the host dirs")
	}
}

// 适配器 profile（Claude / Codex）必须声明本体名，否则这道门形同虚设。
func TestAdapterProfilesDeclareCLINames(t *testing.T) {
	want := map[string]string{"claude": "claude", "codex": "codex"}
	for id, name := range want {
		p := ProfileByID(id)
		if p == nil {
			t.Fatalf("missing %s profile", id)
		}
		if len(p.CLINames) != 1 || p.CLINames[0] != name {
			t.Fatalf("%s CLINames=%v, want [%s]", id, p.CLINames, name)
		}
	}
}

// HostSearchDirs 不能把 OpenSider 自有的适配器 prefix 算进去——那正是判「本体还在」
// 的反面教材。
func TestHostSearchDirsExcludesAdapterPrefixes(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("PATH", "")
	claudeBin, codexBin := paths.ClaudeACPBinDir(), paths.CodexACPBinDir()
	for _, dir := range paths.HostSearchDirs() {
		if dir == claudeBin || dir == codexBin {
			t.Fatalf("HostSearchDirs must not include adapter prefix %s", dir)
		}
	}
}
