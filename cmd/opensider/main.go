package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/parksben/opensider/internal/host"
	"github.com/parksben/opensider/internal/install"
	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/pick"
	"github.com/parksben/opensider/internal/version"
)

func main() {
	raw := os.Args[1:]
	args := stripNativeClientArgs(raw)
	if len(args) == 0 {
		host.Run()
		return
	}
	// 子命令用自己的原始参数：`stripNativeClientArgs` 会把纯数字当成 Chrome 传进来的窗口句柄
	// 丢掉，而 `result <id> --timeout 30` 里的 id 和秒数都可能是数字。
	if isSubcommand(raw[0]) {
		args = raw
	}
	switch args[0] {
	case "install":
		if err := install.Run(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "uninstall":
		purge := false
		for _, arg := range args[1:] {
			if arg == "--purge" {
				purge = true
			}
		}
		if err := install.Uninstall(purge); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "version", "--version":
		// 不带 tag 的 v 前缀，与侧栏、install 输出同一口径（见 internal/version）。
		fmt.Println(version.Display())
	case "extension-dir":
		// 打印（或设置）浏览器实际加载的扩展目录，安装 / 更新 / 体检流程都靠它保持一致。
		if len(args) > 1 {
			if err := paths.SetExtensionDir(args[1]); err != nil {
				fmt.Fprintln(os.Stderr, err)
				os.Exit(1)
			}
		}
		fmt.Println(paths.ExtensionDir())
	case "pick":
		if err := pick.RunCLI(args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "result":
		// `opensider result <id> [--timeout 120]`：等 browser/results/<id>.json 出现并打印它。
		// Agent 用它代替 `sleep 5; cat ...` 这类轮询（那种写法的代价是每个命令白等几秒，
		// 用户看到的就是「一个简单任务也要跑很久」）。
		if err := awaitResult(args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(64)
		}
	default:
		// Chrome already passed only the origin (stripped above). Any other
		// leftover still means "run as the native host" so we never write to
		// stderr and kill the Native Messaging pipe.
		host.Run()
	}
}

func isSubcommand(arg string) bool {
	switch arg {
	case "install", "uninstall", "version", "--version", "extension-dir", "pick", "result":
		return true
	}
	return false
}

// Chrome Native Messaging starts the host as:
//
//	opensider chrome-extension://<id>/
//
// Windows also appends a parent HWND (integer or --parent-window=N).
func stripNativeClientArgs(args []string) []string {
	kept := make([]string, 0, len(args))
	for _, arg := range args {
		if arg == "" {
			continue
		}
		if strings.HasPrefix(arg, "chrome-extension://") {
			continue
		}
		if strings.HasPrefix(arg, "--parent-window=") {
			continue
		}
		if isWindowHandle(arg) {
			continue
		}
		kept = append(kept, arg)
	}
	return kept
}

func isWindowHandle(arg string) bool {
	if arg == "" {
		return false
	}
	for _, r := range arg {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// awaitResult 阻塞等待一条页面命令的结果文件，拿到就原样打印。
//
// 退出码 64 表示超时（脚本最容易识别的「没等到」，与「结果内容里 ok:false」区分开）。
func awaitResult(args []string) error {
	id := ""
	timeout := 120 * time.Second
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--timeout" && i+1 < len(args):
			i++
			seconds, err := strconv.Atoi(args[i])
			if err != nil || seconds <= 0 {
				return fmt.Errorf("invalid --timeout %q", args[i])
			}
			timeout = time.Duration(seconds) * time.Second
		case strings.HasPrefix(arg, "--timeout="):
			seconds, err := strconv.Atoi(strings.TrimPrefix(arg, "--timeout="))
			if err != nil || seconds <= 0 {
				return fmt.Errorf("invalid --timeout %q", arg)
			}
			timeout = time.Duration(seconds) * time.Second
		case strings.HasPrefix(arg, "--"):
			return fmt.Errorf("unknown flag %q", arg)
		case id == "":
			id = arg
		}
	}
	if id == "" {
		return fmt.Errorf("usage: opensider result <id> [--timeout seconds]")
	}
	path := filepath.Join(paths.ResultsDir(), id+".json")
	deadline := time.Now().Add(timeout)
	for {
		raw, err := os.ReadFile(path)
		if err == nil && len(raw) > 0 {
			_, writeErr := os.Stdout.Write(raw)
			return writeErr
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("timed out after %s waiting for %s", timeout, path)
		}
		time.Sleep(150 * time.Millisecond)
	}
}
