//go:build darwin

package addonenv

import (
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/parksben/opensider/internal/log"
)

func startSweep(command, tmpdir string) func() {
	stopCh := make(chan struct{})
	var once sync.Once
	go runSweep(command, tmpdir, stopCh)
	return func() {
		once.Do(func() { close(stopCh) })
	}
}

func runSweep(command, tmpdir string, stopCh <-chan struct{}) {
	roots := sweepRoots(command, tmpdir)
	cleanRoots(roots)
	sweep(roots)
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.Now().Add(20 * time.Second)
	slow := false
	for {
		select {
		case <-stopCh:
			sweep(roots)
			return
		case <-ticker.C:
			sweep(roots)
			if !slow && time.Now().After(deadline) {
				ticker.Reset(time.Second)
				slow = true
			}
		}
	}
}

func sweep(roots []string) {
	walkSignable(roots, trustFile)
}

// cleanRoots 在快扫循环之前把既有残留一次性收拾掉。walkSignable 只处理小于
// 8MB 的 .node/.dylib，像 opensider-art/ocr、Python 的 .so 这类同样会被
// Gatekeeper 拦下的文件它永远碰不到，只能整目录清一遍。
func cleanRoots(roots []string) {
	for _, root := range roots {
		_ = exec.Command("xattr", "-cr", root).Run()
	}
}

// trustSteps 是让 Gatekeeper 放行 path 需要的动作，顺序有意义：先签名，后清
// 属性。
func trustSteps(path string) [][]string {
	return [][]string{
		{"codesign", "--force", "--sign", "-", path},
		{"xattr", "-cr", path},
	}
}

// trustFile 消除 path 上的隔离属性，让 Chrome 拉起的 Agent 不再触发 Gatekeeper。
//
// 顺序不能反：只要创建者的启动链本身带隔离（Chrome 下载安装的 App、以及它的
// 子孙进程都算），macOS 就会给这些进程写出的文件重新打上
// com.apple.quarantine。codesign 也是这条链上的子孙，它重写 Mach-O 时就等于
// 又盖了一次章（实测 0081;…;Chrome; → 0281;…;;）。所以「先清属性、后签名」
// 等于白清：文件永远停在隔离态，Chrome 每次拉起 Agent、dlopen 这些原生库都
// 要再弹一次「无法验证开发者」。签名失败时把 codesign 的输出一起记下来，
// 否则只剩一句 exit status 1，无从排查。
func trustFile(path string) {
	for _, step := range trustSteps(path) {
		args := step[1:]
		if out, err := exec.Command(step[0], args...).CombinedOutput(); err != nil {
			log.Log("addonenv " + step[0] + " skipped: " + path + " " + err.Error() + " " + strings.TrimSpace(string(out)))
		}
	}
}
