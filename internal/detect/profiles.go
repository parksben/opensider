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
	ID             string
	Name           string
	Mark           protocol.AgentMark
	Launches       []Launch
	Env            map[string]string
	Auth           AuthKind
	ModeMap        map[protocol.AgentPolicy][]string
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
			ModeMap:        map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"agent"}, protocol.PolicyWorkspace: {"agent"}, protocol.PolicyAuto: {"agent"}, protocol.PolicyUnattended: {"agent"}},
			ContextFiles:   []string{"AGENTS.md"},
			ListModels:     "agent-models",
			VendorPrefixes: []string{"cursor/"},
			Caps:           stdCaps(protocol.AgentCaps{Questions: true, Plans: true, Todos: true}),
			LoginHint:      "Run `agent login` in a terminal, then retry.",
		},
		{
			ID:           "opencode",
			Name:         "OpenCode",
			Mark:         "opencode",
			Launches:     []Launch{{Command: "opencode", Args: []string{"acp"}}},
			Auth:         AuthKind{Type: "none"},
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default", "ask"}, protocol.PolicyWorkspace: {"acceptEdits"}, protocol.PolicyAuto: {"bypassPermissions", "auto"}, protocol.PolicyUnattended: {"bypassPermissions", "auto"}},
			ContextFiles: []string{"AGENTS.md"},
			ListModels:   "opencode-models",
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Sign in with `opencode` or set OPENCODE_API_KEY, then retry.",
		},
		{
			ID:   "copilot",
			Name: "GitHub Copilot",
			Mark: "copilot",
			Launches: []Launch{
				{Command: "copilot", Args: []string{"--acp", "--stdio"}},
				{Command: "copilot", Args: []string{"--acp"}},
			},
			Auth: AuthKind{Type: "none"},
			ModeMap: map[protocol.AgentPolicy][]string{
				protocol.PolicyAsk:        {"https://agentclientprotocol.com/protocol/session-modes#agent", "default", "ask"},
				protocol.PolicyWorkspace:  {"https://agentclientprotocol.com/protocol/session-modes#agent", "default"},
				protocol.PolicyAuto:       {"https://agentclientprotocol.com/protocol/session-modes#autopilot", "allow-all", "auto"},
				protocol.PolicyUnattended: {"https://agentclientprotocol.com/protocol/session-modes#autopilot", "allow-all", "auto"},
			},
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
			ModeMap:        map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default"}, protocol.PolicyWorkspace: {"default"}, protocol.PolicyAuto: {"auto"}, protocol.PolicyUnattended: {"auto"}},
			ContextFiles:   []string{"AGENTS.md"},
			VendorPrefixes: []string{"codebuddy.ai/", "_codebuddy.ai/"},
			Caps:           stdCaps(protocol.AgentCaps{}),
			LoginHint:      "Sign in with `codebuddy` or set CODEBUDDY_API_KEY, then retry.",
		},
		{
			ID:   "claude",
			Name: "Claude Code",
			Mark: "claude",
			Launches: []Launch{
				{Command: filepath.Join(paths.ClaudeACPBinDir(), "claude-agent-acp"), Args: nil},
				{Command: filepath.Join(paths.ClaudeACPBinDir(), "claude-code-acp"), Args: nil},
				{Command: "claude-agent-acp", Args: nil},
				{Command: "claude-code-acp", Args: nil},
				{Command: filepath.Join(home, ".local", "bin", "claude-agent-acp"), Args: nil},
			},
			Auth: AuthKind{Type: "none"},
			ModeMap: map[protocol.AgentPolicy][]string{
				protocol.PolicyAsk:        {"default", "manual"},
				protocol.PolicyWorkspace:  {"acceptEdits"},
				protocol.PolicyAuto:       {"bypassPermissions"},
				protocol.PolicyUnattended: {"bypassPermissions"},
			},
			ContextFiles:   []string{"AGENTS.md", "CLAUDE.md"},
			VendorPrefixes: []string{"_claude/"},
			Caps:           stdCaps(protocol.AgentCaps{Todos: true}),
			LoginHint:      "Re-run OpenSider install to add the ACP adapter, then sign in with `claude`.",
		},
		{
			ID:   "codex",
			Name: "Codex",
			Mark: "codex",
			Launches: []Launch{
				{Command: "codex-acp", Args: nil},
				{Command: filepath.Join(home, ".local", "bin", "codex-acp"), Args: nil},
			},
			Auth:         AuthKind{Type: "none"},
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"agent"}, protocol.PolicyWorkspace: {"agent"}, protocol.PolicyAuto: {"agent-full-access"}, protocol.PolicyUnattended: {"agent-full-access"}},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{Plans: true}),
			LoginHint:    "Install Codex CLI / `codex-acp` and sign in with ChatGPT or CODEX_API_KEY.",
		},
		{
			ID:   "gemini",
			Name: "Gemini",
			Mark: "gemini",
			Launches: []Launch{
				{Command: "gemini", Args: []string{"--experimental-acp"}},
				{Command: "gemini", Args: []string{"--acp"}},
			},
			Auth:         AuthKind{Type: "none"},
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default"}, protocol.PolicyWorkspace: {"default"}, protocol.PolicyAuto: {"auto"}, protocol.PolicyUnattended: {"auto"}},
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
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default"}, protocol.PolicyWorkspace: {"default"}, protocol.PolicyAuto: {"auto"}, protocol.PolicyUnattended: {"auto"}},
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
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default"}, protocol.PolicyWorkspace: {"default"}, protocol.PolicyAuto: {"auto"}, protocol.PolicyUnattended: {"auto"}},
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
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default"}, protocol.PolicyWorkspace: {"default"}, protocol.PolicyAuto: {"auto"}, protocol.PolicyUnattended: {"auto"}},
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
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default"}, protocol.PolicyWorkspace: {"default"}, protocol.PolicyAuto: {"auto"}, protocol.PolicyUnattended: {"auto"}},
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
			ModeMap:      map[protocol.AgentPolicy][]string{protocol.PolicyAsk: {"default"}, protocol.PolicyWorkspace: {"default"}, protocol.PolicyAuto: {"auto"}, protocol.PolicyUnattended: {"auto"}},
			ContextFiles: []string{"AGENTS.md"},
			Caps:         stdCaps(protocol.AgentCaps{}),
			LoginHint:    "Install Qoder CLI (`qodercli`) and sign in.",
		},
	}
}

func GenericProfile(id, name, command string, args []string) AgentProfile {
	return AgentProfile{
		ID:       id,
		Name:     name,
		Mark:     "generic",
		Launches: []Launch{{Command: command, Args: args}},
		Auth:     AuthKind{Type: "none"},
		ModeMap: map[protocol.AgentPolicy][]string{
			protocol.PolicyAsk:        {"default", "ask", "agent"},
			protocol.PolicyWorkspace:  {"acceptEdits", "agent"},
			protocol.PolicyAuto:       {"bypassPermissions", "agent-full-access", "auto"},
			protocol.PolicyUnattended: {"bypassPermissions", "agent-full-access", "auto"},
		},
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
