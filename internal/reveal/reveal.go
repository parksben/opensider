package reveal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var ErrNotFound = errors.New("file not found")

func Path(raw string) error {
	path := filepath.Clean(raw)
	if path == "" || path == "." {
		return fmt.Errorf("empty path")
	}
	if !filepath.IsAbs(path) {
		return fmt.Errorf("path must be absolute")
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%w: %s", ErrNotFound, path)
		}
		return err
	}
	return reveal(path)
}

// explorerSelectCmdLine 拼出资源管理器「打开所在目录并选中该文件」的原始命令行。
//
// 这件事不能交给 os/exec 拼参数：explorer.exe 不按 CommandLineToArgvW 解析命令行，
// 而 os/exec 只要参数里含空格就把整串加引号 —— `exec.Command("explorer.exe",
// "/select,"+path)` 遇上带空格的路径会拼出 `explorer "/select,C:\a b\c.txt"`，
// explorer 认不出 /select 开关，于是只弹一个跟目标无关的窗口。路径带空格在 Windows
// 上很常见（用户名、主目录、项目目录都可能带），所以这条必须自己拼：返回值等价于
// 手敲 `explorer.exe /select,"C:\a b\c.txt"`，由 SysProcAttr.CmdLine 原样交给
// CreateProcess，不经过任何转义。
//
// 刻意放在这个不带 build tag 的文件里：写进 windows-only 文件就只有 Windows 能跑，
// 本机与 CI 都测不到（断言在 reveal_test.go，调用方是 reveal_windows.go）。
func explorerSelectCmdLine(path string) (string, bool) {
	if path == "" || strings.ContainsRune(path, '"') {
		// 双引号进不了 Windows 文件名，也会把命令行括坏；交给调用方退回打开目录。
		return "", false
	}
	return `explorer.exe /select,"` + path + `"`, true
}
