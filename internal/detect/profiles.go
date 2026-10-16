package detect

import (
	"os"
	"path/filepath"

	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/protocol"
)

type AuthKind struct {
	Type     string
	MethodID string
}

type Launch struct {
	Command string
	Args    []string
}

type AgentProfile struct {
	ID   string
	Name string
	Mark protocol.AgentMark
	// CLINames 是这家 agent「本体」的可执行名（与 install 的 cliNames 同一套口径）。
	// 探测先核实本体还在用户自己的目录里（paths.HostSearchDirs），再谈适配器：
	// Claude / Codex 靠 runtime 里的适配器拉起，但「适配器在」不等于「CLI 还装着」——
	// 用户卸载 CLI 后这一家要从名单里消失（见 hostCLIPresent）。本体即启动命令的
	// 那几家不用填，ResolveOnPath 天然兜住。
	CLINames       []string
	Launches       []Launch
	Env            map[string]string
	Auth           AuthKind
	ContextFiles   []string
	ListModels     string
	VendorPrefixes []string
	Caps           protocol.AgentCaps
	LoginHint      string
}

func stdCaps(over protocol.AgentCaps) protocol.AgentCaps {
	caps := protocol.AgentCaps{Models: true}
	if over.Models {
		caps.Models = true
	}
	caps.Questions = over.Questions
	caps.Plans = over.Plans
	caps.Todos = over.Todos
	return caps
}

func Profiles() []AgentProfile {
	home := paths.Home()
	codebuddyEnv := map[string]string(nil)
	if os.Getenv("CODEBUDDY_INTERNET_ENVIRONMENT") == "" {
		codebuddyEnv = map[string]string{"CODEBUDDY_INTERNET_ENVIRONMENT": "internal"}
	}
	return []AgentProfile{
		{
			ID:   "cursor",
			Name: "Cursor",
			Mark: "cursor",
			Launches: []Launch{
				{Command: paths.DefaultAgentPath(), Args: []string{"acp"}},
				{Command: "agent", Args: []string{"acp"}},
				{Command: "cursor-agent", Args: []string{"acp"}},
			},
			Auth:           AuthKind{Type: "method", MethodID: "cursor_login"},
			ContextFiles:   []string{"AGENTS.md"},
			ListModels:     "agent-models",
			VendorPrefixes: []string{"cursor/"},
			Caps:           stdCaps(protocol.AgentCaps{Questions: true, Plans: true, Todos: true}),
			LoginHint:      "Run `agent login` in a terminal, then retry.",
		},
		{
			ID:       "opencode",
			Name:     "OpenCode",
			Mark:     "opencode",
			Launches: []Launch{{Command: "opencode", Args: []string{"acp"}}},
			// opencode 启动时会把内嵌的 fff 原生库解压到 TMPDIR，而 TMPDIR 是
			// Chrome 拉起的 Host 建的，解压出来的 dylib 会带上
			// com.apple.quarantine。每开一次会话就多一个隔离的 Mach-O，dlopen
			// 时 Gatekeeper 就弹一次「无法验证开发者」。让它走内置实现，从源头
			// 上不再产出隔离文件。
			Env:          map[string]string{"OPENCODE_DISABLE_FFF": "true"},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			ListModels:   "opencode-models",
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Run `opencode auth login` in a terminal, then retry.",
		},
		{
			ID:   "copilot",
			Name: "GitHub Copilot",
			Mark: "copilot",
			Launches: []Launch{
				{Command: "copilot", Args: []string{"--acp", "--stdio"}},
				{Command: "copilot", Args: []string{"--acp"}},
			},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Run `copilot login` in a terminal, then retry.",
		},
		{
			ID:             "codebuddy",
			Name:           "CodeBuddy",
			Mark:           "codebuddy",
			Launches:       []Launch{{Command: "codebuddy", Args: []string{"--acp"}}},
			Env:            codebuddyEnv,
			Auth:           AuthKind{Type: "none"},
			ContextFiles:   []string{"AGENTS.md"},
			VendorPrefixes: []string{"codebuddy.ai/", "_codebuddy.ai/"},
			Caps:           stdCaps(protocol.AgentCaps{}),
			LoginHint:      "Sign in with `codebuddy` or set CODEBUDDY_API_KEY, then retry.",
		},
		{
			ID:   "claude",
			Name: "Claude Code",
			Mark: "claude",
			// 本体是交互式 `claude`；探测列表里列的是适配器，但只有本体还在时才列。
			CLINames: []string{"claude"},
			Launches: []Launch{
				{Command: filepath.Join(paths.ClaudeACPBinDir(), "claude-agent-acp"), Args: nil},
				{Command: filepath.Join(paths.ClaudeACPBinDir(), "claude-code-acp"), Args: nil},
				{Command: "claude-agent-acp", Args: nil},
				{Command: "claude-code-acp", Args: nil},
				{Command: filepath.Join(home, ".local", "bin", "claude-agent-acp"), Args: nil},
			},
			Auth:           AuthKind{Type: "none"},
			ContextFiles:   []string{"AGENTS.md", "CLAUDE.md"},
			VendorPrefixes: []string{"_claude/"},
			Caps:           stdCaps(protocol.AgentCaps{Todos: true}),
			LoginHint:      "Re-run OpenSider install to add the ACP adapter, then sign in with `claude`.",
		},
		{
			ID:   "codex",
			Name: "Codex",
			Mark: "codex",
			// 本体是 `codex`；codex-acp 的 node_modules 里内嵌着一份 `codex`，
			// 不能用 ResolveOnPath 判断本体在不在。
			CLINames: []string{"codex"},
			Launches: []Launch{
				{Command: filepath.Join(paths.CodexACPBinDir(), "codex-acp"), Args: nil},
				{Command: "codex-acp", Args: nil},
				{Command: filepath.Join(home, ".local", "bin", "codex-acp"), Args: nil},
			},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{Plans: true}),
			LoginHint:    "Re-run OpenSider install to add the ACP adapter, then sign in with `codex`.",
		},
		{
			ID:   "gemini",
			Name: "Gemini",
			Mark: "gemini",
			Launches: []Launch{
				{Command: "gemini", Args: []string{"--acp"}},
				{Command: "gemini", Args: []string{"--experimental-acp"}},
			},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Run `gemini` and complete login, then retry.",
		},
		{
			ID:           "qwen",
			Name:         "Qwen Code",
			Mark:         "qwen",
			Launches:     []Launch{{Command: "qwen", Args: []string{"--acp"}}},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Install Qwen Code (`qwen`) and sign in.",
		},
		{
			ID:           "kimi",
			Name:         "Kimi",
			Mark:         "kimi",
			Launches:     []Launch{{Command: "kimi", Args: []string{"acp"}}},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Install Kimi CLI (`kimi`) and sign in.",
		},
		{
			ID:           "iflow",
			Name:         "iFlow",
			Mark:         "iflow",
			Launches:     []Launch{{Command: "iflow", Args: []string{"--experimental-acp"}}},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Install iFlow CLI and sign in.",
		},
		{
			ID:           "trae",
			Name:         "Trae",
			Mark:         "trae",
			Launches:     []Launch{{Command: "traecli", Args: []string{"acp", "serve"}}},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Install Trae CLI (`traecli`) and sign in.",
		},
		{
			ID:           "qoder",
			Name:         "Qoder",
			Mark:         "qoder",
			Launches:     []Launch{{Command: "qodercli", Args: []string{"--acp"}}},
			Auth:         AuthKind{Type: "none"},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Install Qoder CLI (`qodercli`) and sign in.",
		},
	}
}

func GenericProfile(id, name, command string, args []string) AgentProfile {
	return AgentProfile{
		ID:           id,
		Name:         name,
		Mark:         "generic",
		Launches:     []Launch{{Command: command, Args: args}},
		Auth:         AuthKind{Type: "none"},
		ContextFiles: []string{"AGENTS.md"},
		Caps:         stdCaps(protocol.AgentCaps{}),
		LoginHint:    "Sign in with `" + command + "`, then retry.",
	}
}

func ProfileByID(id string) *AgentProfile {
	for _, p := range Profiles() {
		if p.ID == id {
			cp := p
			return &cp
		}
	}
	return nil
}
