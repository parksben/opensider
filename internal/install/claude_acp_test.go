package install

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDecideClaudeACP(t *testing.T) {
	if decideClaudeACP("", "") != claudeACPSkip {
		t.Fatal("no Claude Code should skip")
	}
	if decideClaudeACP("", "/bin/claude-agent-acp") != claudeACPSkip {
		t.Fatal("no Claude Code skips even if an adapter is on PATH")
	}
	if decideClaudeACP("/bin/claude", "/bin/claude-agent-acp") != claudeACPPresent {
		t.Fatal("existing adapter should be treated as present")
	}
	if decideClaudeACP("/bin/claude", "") != claudeACPNeedInstall {
		t.Fatal("Claude without adapter should install")
	}
}

func TestPackageInstallArgs(t *testing.T) {
	npm := npmInstallArgs("/tmp/claude-acp")
	if strings.Join(npm, " ") != "install --omit=dev --no-fund --no-audit --prefix /tmp/claude-acp @agentclientprotocol/claude-agent-acp" {
		t.Fatalf("npm args: %#v", npm)
	}
	pnpm := pnpmAddArgs("/tmp/claude-acp")
	if strings.Join(pnpm, " ") != "add --dir /tmp/claude-acp @agentclientprotocol/claude-agent-acp" {
		t.Fatalf("pnpm args: %#v", pnpm)
	}
	bun := bunAddArgs("/tmp/claude-acp")
	if strings.Join(bun, " ") != "add --cwd /tmp/claude-acp @agentclientprotocol/claude-agent-acp" {
		t.Fatalf("bun args: %#v", bun)
	}
	if packageInstallArgs("yarn", "/tmp") != nil {
		t.Fatal("unknown manager must not invent args")
	}
	if got := packageInstallArgs("npm", "/tmp/x"); strings.Join(got, " ") != strings.Join(npmInstallArgs("/tmp/x"), " ") {
		t.Fatalf("packageInstallArgs npm: %#v", got)
	}
}

func TestWrapScriptCommandForWindowsCmd(t *testing.T) {
	bin, args := wrapScriptCommandFor("windows", `C:\Windows\System32\cmd.exe`, `C:\Program Files\nodejs\npm.cmd`, []string{"install", "--prefix", "x"})
	if bin != `C:\Windows\System32\cmd.exe` {
		t.Fatalf("bin %q", bin)
	}
	want := []string{"/c", `C:\Program Files\nodejs\npm.cmd`, "install", "--prefix", "x"}
	if strings.Join(args, "\n") != strings.Join(want, "\n") {
		t.Fatalf("args %#v", args)
	}
}

func TestWrapScriptCommandForWindowsBatUsesComSpecFallback(t *testing.T) {
	bin, args := wrapScriptCommandFor("windows", "", `D:\pnpm.bat`, []string{"add"})
	if bin != `C:\Windows\System32\cmd.exe` {
		t.Fatalf("fallback ComSpec %q", bin)
	}
	if args[0] != "/c" || args[1] != `D:\pnpm.bat` {
		t.Fatalf("args %#v", args)
	}
}

func TestWrapScriptCommandForLeavesUnixAndExeAlone(t *testing.T) {
	bin, args := wrapScriptCommandFor("darwin", "", "/usr/local/bin/npm", []string{"install"})
	if bin != "/usr/local/bin/npm" || strings.Join(args, " ") != "install" {
		t.Fatalf("unix: %s %#v", bin, args)
	}
	bin, args = wrapScriptCommandFor("windows", `C:\Windows\System32\cmd.exe`, `C:\Program Files\nodejs\node.exe`, []string{"-v"})
	if bin != `C:\Program Files\nodejs\node.exe` || strings.Join(args, " ") != "-v" {
		t.Fatalf("exe must not go through cmd: %s %#v", bin, args)
	}
}

func TestNativeClaudeCandidatesIncludeLocalBin(t *testing.T) {
	found := false
	for _, cand := range nativeClaudeCandidates() {
		slash := filepath.ToSlash(cand)
		if strings.HasSuffix(slash, ".local/bin/claude") || strings.HasSuffix(slash, ".local/bin/claude.exe") {
			found = true
		}
	}
	if !found {
		t.Fatalf("candidates %#v", nativeClaudeCandidates())
	}
	if runtime.GOOS == "windows" {
		if len(nativeClaudeCandidates()) < 2 {
			t.Fatal("Windows should also try claude.exe")
		}
	}
}

func TestEnsureClaudeACPSkipsWhenNoClaude(t *testing.T) {
	if findClaude() != "" {
		t.Skip("this machine has Claude Code; skip-when-no-claude cannot be asserted here")
	}
	if err := EnsureClaudeACP(); err != nil {
		t.Fatalf("skip must not fail: %v", err)
	}
}
