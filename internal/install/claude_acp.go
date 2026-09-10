package install

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/detect"
	"github.com/parksben/opensider/internal/paths"
)

const (
	claudeACPPackage  = "@agentclientprotocol/claude-agent-acp"
	claudeACPTimeout  = 5 * time.Minute
	claudeACPVerifyTO = 4 * time.Second
)

var claudeAdapterNames = []string{"claude-agent-acp", "claude-code-acp"}

type claudeACPAction int

const (
	claudeACPSkip claudeACPAction = iota
	claudeACPPresent
	claudeACPNeedInstall
)

func decideClaudeACP(claude, adapter string) claudeACPAction {
	if claude == "" {
		return claudeACPSkip
	}
	if adapter != "" {
		return claudeACPPresent
	}
	return claudeACPNeedInstall
}

func npmInstallArgs(prefix string) []string {
	return []string{"install", "--omit=dev", "--no-fund", "--no-audit", "--prefix", prefix, claudeACPPackage}
}

func pnpmAddArgs(dir string) []string {
	return []string{"add", "--dir", dir, claudeACPPackage}
}

func bunAddArgs(dir string) []string {
	return []string{"add", "--cwd", dir, claudeACPPackage}
}

func packageInstallArgs(manager, dest string) []string {
	switch manager {
	case "npm":
		return npmInstallArgs(dest)
	case "pnpm":
		return pnpmAddArgs(dest)
	case "bun":
		return bunAddArgs(dest)
	default:
		return nil
	}
}

func wrapScriptCommandFor(goos, comspec, bin string, args []string) (string, []string) {
	if goos != "windows" {
		return bin, args
	}
	ext := strings.ToLower(filepath.Ext(bin))
	if ext != ".cmd" && ext != ".bat" {
		return bin, args
	}
	if comspec == "" {
		comspec = `C:\Windows\System32\cmd.exe`
	}
	return comspec, append([]string{"/c", bin}, args...)
}

func wrapScriptCommand(bin string, args []string) (string, []string) {
	return wrapScriptCommandFor(runtime.GOOS, os.Getenv("ComSpec"), bin, args)
}

func nativeClaudeCandidates() []string {
	home := paths.Home()
	unix := filepath.Join(home, ".local", "bin", "claude")
	if runtime.GOOS == "windows" {
		return []string{
			filepath.Join(home, ".local", "bin", "claude.exe"),
			unix,
		}
	}
	return []string{unix}
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

func findClaude() string {
	if p := detect.ResolveOnPath("claude"); p != "" {
		return p
	}
	for _, cand := range nativeClaudeCandidates() {
		if fileExists(cand) {
			return cand
		}
	}
	return ""
}

func findClaudeAdapter() string {
	for _, name := range claudeAdapterNames {
		if p := detect.ResolveOnPath(name); p != "" {
			return p
		}
		base := filepath.Join(paths.ClaudeACPBinDir(), name)
		if fileExists(base) {
			return base
		}
		if runtime.GOOS == "windows" {
			for _, ext := range []string{".cmd", ".exe", ".bat"} {
				if fileExists(base + ext) {
					return base + ext
				}
			}
		}
	}
	return ""
}

func findPackageManager() (name, bin string) {
	for _, manager := range []string{"npm", "pnpm", "bun"} {
		if p := detect.ResolveOnPath(manager); p != "" {
			return manager, p
		}
	}
	return "", ""
}

func runTimed(bin string, args []string, timeout time.Duration, stdout, stderr io.Writer) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	runBin, runArgs := wrapScriptCommand(bin, args)
	cmd := exec.CommandContext(ctx, runBin, runArgs...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.Env = os.Environ()
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf("timed out after %s", timeout)
		}
		return err
	}
	return nil
}

func verifyClaudeAdapter(path string) bool {
	if !fileExists(path) {
		return false
	}
	if findClaudeAdapter() == "" {
		return false
	}
	_ = runTimed(path, []string{"--version"}, claudeACPVerifyTO, io.Discard, io.Discard)
	return true
}

// EnsureClaudeACP detects Claude Code and, if needed, installs the ACP adapter
// into ~/.opensider/runtime/claude-acp. Failures are returned so the caller can
// print them; they must not abort host registration.
func EnsureClaudeACP() error {
	claude := findClaude()
	adapter := findClaudeAdapter()
	switch decideClaudeACP(claude, adapter) {
	case claudeACPSkip:
		fmt.Println("Claude Code not found; skip ACP adapter setup.")
		return nil
	case claudeACPPresent:
		if !verifyClaudeAdapter(adapter) {
			fmt.Printf("Claude Code ACP adapter at %s could not be verified; leaving it in place.\n", adapter)
			return nil
		}
		fmt.Printf("Claude Code ACP adapter already present: %s\n", adapter)
		return nil
	}

	fmt.Printf("Claude Code found at %s; ACP adapter is missing.\n", claude)
	manager, bin := findPackageManager()
	if manager == "" {
		fmt.Println("Claude Code is installed, but adding the ACP adapter requires Node 18+ (npm, pnpm, or bun). Host install succeeded; Claude will not appear in OpenSider until the adapter is installed.")
		return nil
	}

	dest := paths.ClaudeACPDir()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dest, err)
	}
	args := packageInstallArgs(manager, dest)
	fmt.Printf("Installing %s into %s with %s...\n", claudeACPPackage, dest, manager)
	if err := runTimed(bin, args, claudeACPTimeout, os.Stdout, os.Stderr); err != nil {
		return fmt.Errorf("%s %s: %w", manager, strings.Join(args, " "), err)
	}

	adapter = findClaudeAdapter()
	if adapter == "" || !verifyClaudeAdapter(adapter) {
		return fmt.Errorf("installed %s but detect could not find claude-agent-acp under %s", claudeACPPackage, paths.ClaudeACPBinDir())
	}
	fmt.Printf("Claude Code ACP adapter installed: %s\n", adapter)
	return nil
}
