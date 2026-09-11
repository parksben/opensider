package install

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/parksben/opensider/internal/paths"
)

func TestDecideACPAction(t *testing.T) {
	if decideACPAction("", "") != acpSkip {
		t.Fatal("no CLI should skip")
	}
	if decideACPAction("", "/bin/claude-agent-acp") != acpSkip {
		t.Fatal("no CLI skips even if an adapter is on PATH")
	}
	if decideACPAction("/bin/claude", "/bin/claude-agent-acp") != acpPresent {
		t.Fatal("existing adapter should be treated as present")
	}
	if decideACPAction("/bin/claude", "") != acpNeedInstall {
		t.Fatal("CLI without adapter should install")
	}
	// Codex 走同一套判断，不应再有自己的分支
	if decideACPAction("/opt/homebrew/bin/codex", "") != acpNeedInstall {
		t.Fatal("Codex without adapter should install")
	}
	if decideACPAction("", "/x/codex-acp") != acpSkip {
		t.Fatal("no Codex CLI should skip")
	}
}

func TestAdapterArgs(t *testing.T) {
	npm := adapterArgs("npm", claudeACPPackage, "/tmp/claude-acp")
	if strings.Join(npm, " ") != "install --omit=dev --no-fund --no-audit --prefix /tmp/claude-acp @agentclientprotocol/claude-agent-acp" {
		t.Fatalf("npm args: %#v", npm)
	}
	pnpm := adapterArgs("pnpm", codexACPPackage, "/tmp/codex-acp")
	if strings.Join(pnpm, " ") != "add --dir /tmp/codex-acp @agentclientprotocol/codex-acp" {
		t.Fatalf("pnpm args: %#v", pnpm)
	}
	bun := adapterArgs("bun", codexACPPackage, "/tmp/codex-acp")
	if strings.Join(bun, " ") != "add --cwd /tmp/codex-acp @agentclientprotocol/codex-acp" {
		t.Fatalf("bun args: %#v", bun)
	}
	if adapterArgs("yarn", codexACPPackage, "/tmp") != nil {
		t.Fatal("unknown manager must not invent args")
	}
}

func TestAdapterSpecsPointAtRuntimePrefixes(t *testing.T) {
	claude := claudeSpec()
	if claude.dir != paths.ClaudeACPDir() || claude.binDir != paths.ClaudeACPBinDir() {
		t.Fatalf("claude spec %#v", claude)
	}
	codex := codexSpec()
	if codex.dir != paths.CodexACPDir() || codex.binDir != paths.CodexACPBinDir() {
		t.Fatalf("codex spec %#v", codex)
	}
	if codex.pkg != "@agentclientprotocol/codex-acp" || strings.Join(codex.bins, ",") != "codex-acp" {
		t.Fatalf("codex package/bins %#v", codex)
	}
	if len(codex.cliNames) != 1 || codex.cliNames[0] != "codex" {
		t.Fatalf("codex cli names %#v", codex.cliNames)
	}
	// binDir 必须是 prefix 下的 node_modules/.bin，探测才能靠 AgentSearchDirs 找到
	if filepath.Base(codex.binDir) != ".bin" || filepath.Base(filepath.Dir(codex.binDir)) != "node_modules" {
		t.Fatalf("codex bin dir %q", codex.binDir)
	}
}

func TestEnsureACPSkipsWithoutCLI(t *testing.T) {
	// 不碰真实机器状态：故意给一个必然找不到的 CLI 名，断言直接跳过且不报错。
	spec := acpAdapterSpec{id: "none", label: "None", cliNames: []string{"opensider-no-such-cli"}, pkg: "x"}
	if err := ensureACPAdapter(spec); err != nil {
		t.Fatalf("skip must not fail: %v", err)
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
