package install

import (
	"path/filepath"
	"runtime"

	"github.com/parksben/opensider/internal/paths"
)

const claudeACPPackage = "@agentclientprotocol/claude-agent-acp"

var claudeAdapterNames = []string{"claude-agent-acp", "claude-code-acp"}

// claudeSpec：Claude Code 本体不带 ACP，装官方适配器包进 runtime/claude-acp。
func claudeSpec() acpAdapterSpec {
	return acpAdapterSpec{
		id:       "claude",
		label:    "Claude Code",
		cliNames: []string{"claude"},
		cliCands: nativeClaudeCandidates(),
		pkg:      claudeACPPackage,
		bins:     claudeAdapterNames,
		dir:      paths.ClaudeACPDir(),
		binDir:   paths.ClaudeACPBinDir(),
	}
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

// EnsureClaudeACP detects Claude Code and, if needed, installs the ACP adapter
// into ~/.opensider/runtime/claude-acp. Failures are returned so the caller can
// print them; they must not abort host registration.
func EnsureClaudeACP() error {
	return ensureACPAdapter(claudeSpec())
}
