package paths

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentNativeDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", "")
	got := AgentNativeDir("opencode")
	want := filepath.Join(home, ".opensider", "runtime", "natives", "opencode")
	if got != want {
		t.Fatalf("AgentNativeDir = %s, want %s", got, want)
	}
	if AgentNativeDir("  ") != filepath.Join(home, ".opensider", "runtime", "natives", "agent") {
		t.Fatalf("empty id fallback")
	}
}

func TestClaudeACPPaths(t *testing.T) {
	dir := filepath.ToSlash(ClaudeACPDir())
	if !strings.HasSuffix(dir, ".opensider/runtime/claude-acp") {
		t.Fatalf("ClaudeACPDir %s", dir)
	}
	bin := filepath.ToSlash(ClaudeACPBinDir())
	if !strings.HasSuffix(bin, ".opensider/runtime/claude-acp/node_modules/.bin") {
		t.Fatalf("ClaudeACPBinDir %s", bin)
	}
}

func TestAgentSearchDirsIncludesClaudeACPBinDir(t *testing.T) {
	want := ClaudeACPBinDir()
	for _, dir := range AgentSearchDirs() {
		if dir == want {
			return
		}
	}
	t.Fatalf("AgentSearchDirs missing %s", want)
}

// 没记录过扩展目录时的默认值：家目录下的 OpenSider，不是下载目录。
func TestExtensionDirDefaultsToHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", "")

	if got, want := ExtensionDir(), filepath.Join(home, "OpenSider"); got != want {
		t.Fatalf("ExtensionDir() = %s, want %s", got, want)
	}
}

// v0.2.1 之前默认放下载目录，没记录过路径的老用户要被找出来。
func TestExtensionDirFindsLegacyDownloadsInstall(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", "")

	legacy := filepath.Join(home, "Downloads", "OpenSider")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "manifest.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	if got := ExtensionDir(); got != legacy {
		t.Fatalf("ExtensionDir() = %s, want %s", got, legacy)
	}
}

// 同名目录但没装扩展时不算，避免把随便一个 Downloads/OpenSider 当扩展目录。
func TestExtensionDirIgnoresLegacyDirWithoutManifest(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", "")

	if err := os.MkdirAll(filepath.Join(home, "Downloads", "OpenSider"), 0o755); err != nil {
		t.Fatal(err)
	}

	if got, want := ExtensionDir(), filepath.Join(home, "OpenSider"); got != want {
		t.Fatalf("ExtensionDir() = %s, want %s", got, want)
	}
}

// 记录过的路径最优先——即便新老默认位置都装着扩展。
func TestExtensionDirPrefersRecord(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", "")

	recorded := filepath.Join(home, "Tools", "OpenSider")
	for _, dir := range []string{recorded, filepath.Join(home, "OpenSider"), filepath.Join(home, "Downloads", "OpenSider")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := SetExtensionDir(recorded); err != nil {
		t.Fatal(err)
	}

	if got := ExtensionDir(); got != recorded {
		t.Fatalf("ExtensionDir() = %s, want %s", got, recorded)
	}
}
