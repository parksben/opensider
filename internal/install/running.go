package install

import (
	"encoding/csv"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"github.com/parksben/opensider/internal/paths"
)

// RunningHostPIDs 找出仍在运行的桥接进程（不含自己）。
//
// Chrome 在扩展连着的时候会一直持有这个进程；它收到页面 / 标签更新时会写工作区文件，
// 于是刚被卸载删掉的 ~/.opensider 又会被它重建出来。卸载流程要据此提醒用户先关掉侧栏。
// 找不到 pgrep / tasklist 就返回空——这只是提醒，失败不该影响卸载本身。
func RunningHostPIDs() []string {
	self := os.Getpid()
	if runtime.GOOS == "windows" {
		out, err := exec.Command("tasklist", "/FI", "IMAGENAME eq "+paths.RuntimeBinaryName(), "/FO", "CSV", "/NH").Output()
		if err != nil {
			return nil
		}
		return parseTasklist(string(out), self)
	}
	out, err := exec.Command("pgrep", "-f", paths.RuntimeBinaryPath()).Output()
	if err != nil {
		return nil
	}
	var pids []string
	for _, field := range strings.Fields(string(out)) {
		pid, err := strconv.Atoi(field)
		if err != nil || pid == self {
			continue
		}
		pids = append(pids, field)
	}
	return pids
}

// parseTasklist 读 tasklist 的 CSV 输出（"opensider.exe","1234",…），挑出 PID。
func parseTasklist(out string, self int) []string {
	var pids []string
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "INFO:") {
			continue
		}
		record, err := csv.NewReader(strings.NewReader(line)).Read()
		if err != nil || len(record) < 2 {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(record[1]))
		if err != nil || pid == self {
			continue
		}
		pids = append(pids, record[1])
	}
	return pids
}
