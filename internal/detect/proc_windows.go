//go:build windows

package detect

import (
	"os/exec"
	"syscall"
)

func sysProcAttr() *syscall.SysProcAttr {
	return nil
}

func killCmd(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}
