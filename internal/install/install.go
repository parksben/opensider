package install

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/version"
	"github.com/parksben/opensider/internal/workspace"
)

const previousHost = "com.cursor.sidebar.host"

// Run 把本机桥接登记好：确保工作区、把二进制放到 runtime、写各浏览器的 Native
// Messaging 清单、给缺 ACP 的 CLI 装适配器。
//
// 下载二进制与 extension.zip 不在这里做——安装/更新由用户自己的 AI Agent 按仓库
// 里的 skill 驱动（skill 先下载并放到 runtime，再调本命令登记）。
func Run() error {
	if err := os.MkdirAll(paths.CommandsDir(), 0o755); err != nil {
		return err
	}
	_ = os.MkdirAll(paths.ResultsDir(), 0o755)
	_ = os.MkdirAll(paths.ScreenshotsDir(), 0o755)
	_ = os.MkdirAll(paths.PastedDir(), 0o755)
	_ = os.MkdirAll(paths.OutputsDir(), 0o755)
	_ = os.MkdirAll(paths.RuntimeDir(), 0o755)
	workspace.Ensure()

	bin := paths.RuntimeBinaryPath()
	if err := copySelf(bin); err != nil {
		return err
	}

	if err := os.Chmod(bin, 0o755); err != nil && runtime.GOOS != "windows" {
		return err
	}
	abs, err := filepath.Abs(bin)
	if err != nil {
		return err
	}
	dirs, err := Register(abs)
	if err != nil {
		return err
	}
	fmt.Printf("Registered %s\n", protocol.HostName)
	fmt.Printf("Version: %s\n", version.Version)
	fmt.Printf("Host: %s\n", abs)
	fmt.Printf("Allowed origins: chrome-extension://%s/ chrome-extension://%s/\n", protocol.ExtensionID, protocol.PackedExtensionID)
	fmt.Printf("Workspace: %s\n", paths.WorkspaceDir())
	fmt.Printf("Extension folder (load unpacked from here): %s\n", paths.ExtensionDir())
	fmt.Printf("Manifests: %s\n", strings.Join(dirs, ", "))
	if err := EnsureClaudeACP(); err != nil {
		fmt.Printf("Claude Code ACP setup did not finish: %s\nHost install succeeded.\n", err)
		log.Log("claude acp setup failed: " + err.Error())
	}
	if err := EnsureCodexACP(); err != nil {
		fmt.Printf("Codex ACP setup did not finish: %s\nHost install succeeded.\n", err)
		log.Log("codex acp setup failed: " + err.Error())
	}
	log.Log("install complete host=" + abs)
	return nil
}

func copySelf(dest string) error {
	src, err := os.Executable()
	if err != nil {
		return err
	}
	src, err = filepath.EvalSymlinks(src)
	if err != nil {
		src, _ = os.Executable()
	}
	absDest, _ := filepath.Abs(dest)
	if sameFile(src, absDest) {
		return nil
	}
	_ = os.MkdirAll(filepath.Dir(dest), 0o755)
	tmp := dest + ".tmp"
	if err := copyFile(src, tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(dest)
		if err2 := os.Rename(tmp, dest); err2 != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func sameFile(a, b string) bool {
	ai, err1 := os.Stat(a)
	bi, err2 := os.Stat(b)
	if err1 != nil || err2 != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return os.SameFile(ai, bi)
}
