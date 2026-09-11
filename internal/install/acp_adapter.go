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
)

// 有些 Agent CLI 本体不带 ACP，得再补一个适配器包才能被 Host 拉起来
// （Claude Code 用 @agentclientprotocol/claude-agent-acp，Codex 用
// @agentclientprotocol/codex-acp）。
//
// 两者走同一套机制：装进 ~/.opensider/runtime/<id>-acp，再把该 prefix 的
// node_modules/.bin 算进 paths.AgentSearchDirs，探测侧就能列名。以后遇到同类
// CLI，只要补一份 acpAdapterSpec，不必再写一遍安装流程。
type acpAdapterSpec struct {
	id       string   // 日志用 id，同时是安装目录名（claude / codex）
	label    string   // 面向用户的名称（Claude Code / Codex）
	cliNames []string // 本机 CLI 的可执行名；一个都找不到就不装适配器
	cliCands []string // PATH 之外的 CLI 绝对路径候选
	pkg      string   // 适配器 npm 包名
	bins     []string // 适配器提供的可执行名
	dir      string   // 适配器安装根目录
	binDir   string   // 适配器可执行所在目录（node_modules/.bin）
}

const (
	adapterInstallTimeout = 5 * time.Minute
	adapterVerifyTimeout  = 4 * time.Second
)

type acpAction int

const (
	acpSkip acpAction = iota
	acpPresent
	acpNeedInstall
)

// decideACPAction 决定要不要给这家 CLI 装适配器：没装 CLI 就跳过；已经有适配器
// 就别动它；只有「装了 CLI 但没适配器」才装。
func decideACPAction(cli, adapter string) acpAction {
	if cli == "" {
		return acpSkip
	}
	if adapter != "" {
		return acpPresent
	}
	return acpNeedInstall
}

// adapterArgs 按包管理器给出「把 pkg 装进 dest」的参数。未知管理器返回 nil，
// 不猜参数。
func adapterArgs(manager, pkg, dest string) []string {
	switch manager {
	case "npm":
		return []string{"install", "--omit=dev", "--no-fund", "--no-audit", "--prefix", dest, pkg}
	case "pnpm":
		return []string{"add", "--dir", dest, pkg}
	case "bun":
		return []string{"add", "--cwd", dest, pkg}
	default:
		return nil
	}
}

func findHostCLI(spec acpAdapterSpec) string {
	for _, name := range spec.cliNames {
		if p := detect.ResolveOnPath(name); p != "" {
			return p
		}
	}
	for _, cand := range spec.cliCands {
		if fileExists(cand) {
			return cand
		}
	}
	return ""
}

func findAdapterBin(spec acpAdapterSpec) string {
	for _, name := range spec.bins {
		if p := detect.ResolveOnPath(name); p != "" {
			return p
		}
		base := filepath.Join(spec.binDir, name)
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

func verifyAdapter(spec acpAdapterSpec, path string) bool {
	if !fileExists(path) {
		return false
	}
	if findAdapterBin(spec) == "" {
		return false
	}
	_ = runTimed(path, []string{"--version"}, adapterVerifyTimeout, io.Discard, io.Discard)
	return true
}

// ensureACPAdapter 检测 spec 对应的 CLI，缺适配器就装进 spec.dir。失败会返回给
// 调用方打印，绝不能让整次 Host 安装失败。
func ensureACPAdapter(spec acpAdapterSpec) error {
	cli := findHostCLI(spec)
	adapter := findAdapterBin(spec)
	switch decideACPAction(cli, adapter) {
	case acpSkip:
		fmt.Printf("%s not found; skip ACP adapter setup.\n", spec.label)
		return nil
	case acpPresent:
		if !verifyAdapter(spec, adapter) {
			fmt.Printf("%s ACP adapter at %s could not be verified; leaving it in place.\n", spec.label, adapter)
			return nil
		}
		fmt.Printf("%s ACP adapter already present: %s\n", spec.label, adapter)
		return nil
	}

	fmt.Printf("%s found at %s; ACP adapter is missing.\n", spec.label, cli)
	manager, bin := findPackageManager()
	if manager == "" {
		fmt.Printf("%s is installed, but adding the ACP adapter requires Node 18+ (npm, pnpm, or bun). Host install succeeded; %s will not appear in OpenSider until the adapter is installed.\n", spec.label, spec.label)
		return nil
	}

	if err := os.MkdirAll(spec.dir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", spec.dir, err)
	}
	args := adapterArgs(manager, spec.pkg, spec.dir)
	fmt.Printf("Installing %s into %s with %s...\n", spec.pkg, spec.dir, manager)
	if err := runTimed(bin, args, adapterInstallTimeout, os.Stdout, os.Stderr); err != nil {
		return fmt.Errorf("%s %s: %w", manager, strings.Join(args, " "), err)
	}

	adapter = findAdapterBin(spec)
	if adapter == "" || !verifyAdapter(spec, adapter) {
		return fmt.Errorf("installed %s but detect could not find %s under %s", spec.pkg, spec.bins[0], spec.binDir)
	}
	fmt.Printf("%s ACP adapter installed: %s\n", spec.label, adapter)
	return nil
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
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
