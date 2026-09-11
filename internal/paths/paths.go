package paths

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func Home() string {
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	if h := os.Getenv("USERPROFILE"); h != "" {
		return h
	}
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	return ""
}

func SidebarHome() string {
	return filepath.Join(Home(), ".opensider")
}

func WorkspaceDir() string    { return filepath.Join(SidebarHome(), "workspace") }
func OutputsDir() string      { return filepath.Join(WorkspaceDir(), "outputs") }
func BrowserDir() string      { return filepath.Join(WorkspaceDir(), "browser") }
func CommandsDir() string     { return filepath.Join(BrowserDir(), "commands") }
func ResultsDir() string      { return filepath.Join(BrowserDir(), "results") }
func ScreenshotsDir() string  { return filepath.Join(BrowserDir(), "screenshots") }
func PastedDir() string       { return filepath.Join(BrowserDir(), "pasted") }
func ToolsPath() string       { return filepath.Join(BrowserDir(), "tools.json") }
func CurrentPagePath() string { return filepath.Join(BrowserDir(), "current.json") }
func TabsPath() string        { return filepath.Join(BrowserDir(), "tabs.json") }
func SnapshotPath() string    { return filepath.Join(BrowserDir(), "snapshot.md") }
func InteractivePath() string { return filepath.Join(BrowserDir(), "interactive.md") }
func AgentsMDPath() string    { return filepath.Join(WorkspaceDir(), "AGENTS.md") }
func ClaudeMDPath() string    { return filepath.Join(WorkspaceDir(), "CLAUDE.md") }
func SessionPath() string     { return filepath.Join(SidebarHome(), "session.json") }
func UIStatePath() string     { return filepath.Join(SidebarHome(), "ui-state.json") }
func HostLogPath() string     { return filepath.Join(SidebarHome(), "host.log") }
func RuntimeDir() string      { return filepath.Join(SidebarHome(), "runtime") }
func ExtensionDir() string    { return filepath.Join(SidebarHome(), "extension") }

// ClaudeACPDir is the prefix-local install root for @agentclientprotocol/claude-agent-acp.
func ClaudeACPDir() string { return filepath.Join(RuntimeDir(), "claude-acp") }

// ClaudeACPBinDir is that prefix's node_modules/.bin (claude-agent-acp shims).
func ClaudeACPBinDir() string { return filepath.Join(ClaudeACPDir(), "node_modules", ".bin") }

// CodexACPDir is the prefix-local install root for @agentclientprotocol/codex-acp.
func CodexACPDir() string { return filepath.Join(RuntimeDir(), "codex-acp") }

// CodexACPBinDir is that prefix's node_modules/.bin (codex-acp shims).
func CodexACPBinDir() string { return filepath.Join(CodexACPDir(), "node_modules", ".bin") }

func RuntimeBinaryName() string {
	if runtime.GOOS == "windows" {
		return "opensider.exe"
	}
	return "opensider"
}

func RuntimeBinaryPath() string {
	return filepath.Join(RuntimeDir(), RuntimeBinaryName())
}

func DefaultAgentPath() string {
	if p := os.Getenv("CURSOR_AGENT_PATH"); p != "" {
		return p
	}
	name := "agent"
	if runtime.GOOS == "windows" {
		name = "agent.exe"
	}
	return filepath.Join(Home(), ".local", "bin", name)
}

func considerDir(dirs *[]string, seen map[string]bool, dir string) {
	if dir == "" || seen[dir] {
		return
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return
	}
	seen[dir] = true
	*dirs = append(*dirs, dir)
}

func versionManagerBins() []string {
	home := Home()
	var dirs []string
	seen := map[string]bool{}
	consider := func(dir string) { considerDir(&dirs, seen, dir) }

	consider(filepath.Join(home, ".local", "bin"))
	consider(filepath.Join(home, ".opencode", "bin"))
	consider(filepath.Join(home, ".npm-global", "bin"))
	consider(filepath.Join(home, ".npm-global"))
	consider(filepath.Join(home, ".bun", "bin"))
	consider(filepath.Join(home, ".volta", "bin"))
	consider(filepath.Join(home, ".asdf", "shims"))
	consider(filepath.Join(home, ".cargo", "bin"))
	consider(filepath.Join(home, "Library", "pnpm"))
	consider(filepath.Join(home, ".opensider", "runtime", "bin"))
	consider("/opt/homebrew/bin")
	consider("/usr/local/bin")
	consider("/usr/bin")
	consider("/home/linuxbrew/.linuxbrew/bin")

	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			consider(filepath.Join(local, "fnm"))
			consider(filepath.Join(local, "Programs", "fnm"))
			consider(filepath.Join(local, "Yarn", "bin"))
		}
		if roaming := os.Getenv("APPDATA"); roaming != "" {
			consider(filepath.Join(roaming, "npm"))
			consider(filepath.Join(roaming, "fnm"))
		}
		consider(filepath.Join(home, "scoop", "shims"))
		consider(filepath.Join(home, "AppData", "Roaming", "npm"))
		if nvm := os.Getenv("NVM_HOME"); nvm != "" {
			consider(nvm)
		}
		if link := os.Getenv("NVM_SYMLINK"); link != "" {
			consider(link)
		}
		consider(`C:\Program Files\nodejs`)
		consider(`C:\Program Files (x86)\nodejs`)
	}

	nvmRoot := os.Getenv("NVM_DIR")
	if nvmRoot == "" {
		nvmRoot = filepath.Join(home, ".nvm")
	}
	consider(filepath.Join(nvmRoot, "current", "bin"))
	nvmVersions := filepath.Join(nvmRoot, "versions", "node")
	if entries, err := os.ReadDir(nvmVersions); err == nil {
		for i := len(entries) - 1; i >= 0; i-- {
			name := entries[i].Name()
			consider(filepath.Join(nvmVersions, name, "bin"))
		}
	}

	fnmHome := os.Getenv("FNM_DIR")
	if fnmHome == "" {
		fnmHome = filepath.Join(home, ".fnm")
	}
	consider(filepath.Join(fnmHome, "current", "bin"))
	fnmCandidates := []string{
		filepath.Join(home, "Library", "Application Support", "fnm", "node-versions"),
		filepath.Join(home, ".local", "share", "fnm", "node-versions"),
		filepath.Join(fnmHome, "node-versions"),
	}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		fnmCandidates = append(fnmCandidates, filepath.Join(local, "fnm", "node-versions"))
	}
	for _, root := range fnmCandidates {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for i := len(entries) - 1; i >= 0; i-- {
			name := entries[i].Name()
			consider(filepath.Join(root, name, "installation", "bin"))
			consider(filepath.Join(root, name, "bin"))
		}
	}

	return dirs
}

func AgentSearchDirs() []string {
	fromEnv := filepath.SplitList(os.Getenv("PATH"))
	seen := map[string]bool{}
	var out []string
	// Always include the OpenSider-owned ACP prefixes so detect finds the
	// adapters even if the directory was just created (considerDir would skip it).
	ours := []string{ClaudeACPBinDir(), CodexACPBinDir()}
	for _, dir := range append(ours, append(versionManagerBins(), fromEnv...)...) {
		if dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		out = append(out, dir)
	}
	return out
}

func AgentPathEnv(command string) string {
	dirs := AgentSearchDirs()
	if command != "" {
		dir := filepath.Dir(command)
		if dir != "" && dir != "." {
			dirs = append([]string{dir}, dirs...)
		}
	}
	seen := map[string]bool{}
	var uniq []string
	for _, dir := range dirs {
		if dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		uniq = append(uniq, dir)
	}
	return strings.Join(uniq, string(os.PathListSeparator))
}

func PathExts() []string {
	if runtime.GOOS != "windows" {
		return []string{""}
	}
	raw := os.Getenv("PATHEXT")
	if raw == "" {
		raw = ".COM;.EXE;.BAT;.CMD"
	}
	var exts []string
	seen := map[string]bool{"": true}
	exts = append(exts, "")
	for _, part := range strings.Split(raw, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !strings.HasPrefix(part, ".") {
			part = "." + part
		}
		key := strings.ToLower(part)
		if seen[key] {
			continue
		}
		seen[key] = true
		exts = append(exts, part)
	}
	return exts
}
