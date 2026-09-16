package paths

import (
	"errors"
	"fmt"
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

// NativeUIPath 是扩展报上来的原生 UI 事件流（页面弹的 alert / confirm / prompt / print /
// window.open / 文件选择器），最近 50 条，供 Agent 读；见 TECH_DESIGN「原生 UI 感知与代答」。
func NativeUIPath() string { return filepath.Join(BrowserDir(), "native-ui.json") }
func AgentsMDPath() string { return filepath.Join(WorkspaceDir(), "AGENTS.md") }
func ClaudeMDPath() string { return filepath.Join(WorkspaceDir(), "CLAUDE.md") }
func SessionPath() string  { return filepath.Join(SidebarHome(), "session.json") }
func UIStatePath() string  { return filepath.Join(SidebarHome(), "ui-state.json") }
func HostLogPath() string  { return filepath.Join(SidebarHome(), "host.log") }

// ReleaseCheckPath 缓存「最新 Release 的 tag」，见 internal/release。
func ReleaseCheckPath() string { return filepath.Join(SidebarHome(), "release-check.json") }

func RuntimeDir() string { return filepath.Join(SidebarHome(), "runtime") }

// AgentNativeDir is a stable TMPDIR for one Agent CLI so macOS Gatekeeper
// does not treat every Chrome-spawned extract of the same .node as a new file.
func AgentNativeDir(agentID string) string {
	id := strings.TrimSpace(agentID)
	if id == "" {
		id = "agent"
	}
	return filepath.Join(RuntimeDir(), "natives", id)
}

// ExtensionPathFile 记录用户选定的扩展目录（单行绝对路径）。没有这个文件就用默认值。
func ExtensionPathFile() string { return filepath.Join(SidebarHome(), "extension-path") }

// DefaultExtensionDir 是用户没有指定时的位置：家目录下的 OpenSider。
//
// 不默认放下载目录：那是「清理下载」和清理工具的常客，被删掉后扩展会一直失效到用户
// 重新加载为止。家目录下既看得见、也不会被顺手清掉。安装流程会问用户，实际位置由
// extension-path 记录。
func DefaultExtensionDir() string { return filepath.Join(Home(), "OpenSider") }

// ExtensionDir 返回解压后的扩展目录：用户在「加载已解压的扩展程序」里选的就是它。
//
// 位置由安装流程问过用户后写进 extension-path（见 SetExtensionDir），没记录过才猜：先看
// 新默认位置（家目录下的 OpenSider），再看 v0.2.1 之前的老默认位置（下载目录下的
// OpenSider），两者都只看真的装着扩展（有 manifest.json）的那个。之所以不放 ~/.opensider：
// 点目录在系统文件选择器里默认不可见，而「手动加载扩展」这一步必须用户自己完成。无论放
// 哪里，它都得长期留在原处——Chrome 每次启动都从这里读扩展。
func ExtensionDir() string {
	if raw, err := os.ReadFile(ExtensionPathFile()); err == nil {
		if p := strings.TrimSpace(string(raw)); p != "" {
			return p
		}
	}
	for _, dir := range []string{DefaultExtensionDir(), legacyExtensionDir()} {
		if dir != "" && hasManifest(dir) {
			return dir
		}
	}
	return DefaultExtensionDir()
}

// legacyExtensionDir 是 v0.2.1 之前的老默认位置：下载目录下的 OpenSider。当年没记录过路径
// 就加载在那儿的用户，记录还是空的，得把它们找出来，免得 doctor / update 指着一个空目录。
// 没装扩展（没有 manifest.json）就不算——那个目录可能只是同名。
func legacyExtensionDir() string {
	home := Home()
	dirs := []string{filepath.Join(home, "Downloads", "OpenSider")}
	if profile := os.Getenv("USERPROFILE"); profile != "" {
		dirs = append([]string{filepath.Join(profile, "Downloads", "OpenSider")}, dirs...)
	}
	for _, dir := range dirs {
		if hasManifest(dir) {
			return dir
		}
	}
	return ""
}

// hasManifest 判断一个目录里是不是真的解压着一份扩展。
func hasManifest(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, "manifest.json"))
	return err == nil && !st.IsDir()
}

// SetExtensionDir 记住用户选定的扩展目录。只接受绝对路径，且不能在 ~/.opensider 里
// （点目录在文件选择器里不可见，放那儿等于把「加载扩展」变成一道坑）。
func SetExtensionDir(dir string) error {
	clean := filepath.Clean(strings.TrimSpace(dir))
	if clean == "" || clean == "." {
		return errors.New("extension dir is empty")
	}
	if !filepath.IsAbs(clean) {
		return fmt.Errorf("extension dir must be an absolute path: %s", dir)
	}
	if sidebar := SidebarHome(); clean == sidebar || strings.HasPrefix(clean, sidebar+string(os.PathSeparator)) {
		return fmt.Errorf("extension dir must be outside %s (dot folders are hidden in the file picker): %s", sidebar, clean)
	}
	if err := os.MkdirAll(SidebarHome(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(ExtensionPathFile(), []byte(clean+"\n"), 0o644)
}

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
