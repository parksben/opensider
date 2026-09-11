package install

import (
	"github.com/parksben/opensider/internal/paths"
)

const codexACPPackage = "@agentclientprotocol/codex-acp"

var codexAdapterNames = []string{"codex-acp"}

// codexSpec：Codex CLI 本体不带 ACP，装官方适配器包进 runtime/codex-acp。
// CLI 只按 "codex" 在 AgentSearchDirs 里找（npm -g / brew / ~/.local/bin 都在
// 那份目录里），不再另列绝对路径候选。
func codexSpec() acpAdapterSpec {
	return acpAdapterSpec{
		id:       "codex",
		label:    "Codex",
		cliNames: []string{"codex"},
		pkg:      codexACPPackage,
		bins:     codexAdapterNames,
		dir:      paths.CodexACPDir(),
		binDir:   paths.CodexACPBinDir(),
	}
}

// EnsureCodexACP detects the Codex CLI and, if needed, installs the ACP adapter
// into ~/.opensider/runtime/codex-acp. Same contract as EnsureClaudeACP:
// failures are returned so the caller can print them, and they must not abort
// host registration.
func EnsureCodexACP() error {
	return ensureACPAdapter(codexSpec())
}
