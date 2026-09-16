//go:build windows

package reveal

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// reveal 让资源管理器打开 path 所在目录并选中它。
//
// 命令行走 SysProcAttr.CmdLine 自己拼（见 explorerSelectCmdLine）：交给 os/exec 拼
// 参数时，只要路径含空格就会被整串加引号，explorer 认不出 /select 开关，只会弹一个
// 跟目标无关的窗口 —— 那正是「点了打开文件位置，却没打开对应目录」的原因。
//
// 不再设 HideWindow：explorer.exe 是 GUI 程序，没有控制台要藏；而 SW_HIDE 万一落到
// 由本进程新建的资源管理器窗口上，会把它直接藏起来（表现还是「什么都没打开」）。
func reveal(path string) error {
	if cmdLine, ok := explorerSelectCmdLine(path); ok {
		cmd := exec.Command("explorer.exe")
		cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: cmdLine}
		cmd.Stdin = nil
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Run(); err == nil || toleratedExit(err) {
			return nil
		}
	}
	// 命令行没能起来（非法字符、explorer 被换掉等）时退一步：至少把目录打开，
	// 别什么都不做。只有真起不来才会走到这里，不会在已经弹过窗口后再弹一个。
	dir := path
	if st, err := os.Stat(path); err == nil && !st.IsDir() {
		dir = filepath.Dir(path)
	}
	open := exec.Command("explorer.exe", dir)
	open.Stdin = nil
	open.Stdout = nil
	open.Stderr = nil
	return open.Run()
}

// toleratedExit：explorer 选中成功后也常返回 1，不能当成失败。
func toleratedExit(err error) bool {
	exit, ok := err.(*exec.ExitError)
	return ok && exit.ExitCode() == 1
}
