//go:build darwin

package addonenv

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const probeQuarantine = "0081;6ac71ec7;Chrome;"

// quarantineOf 读 path 上的 quarantine 值，没有则返回空串。
func quarantineOf(path string) string {
	out, err := exec.Command("xattr", "-p", "com.apple.quarantine", path).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// probeDylib 造一个真实的小体积 Mach-O dylib 并打上 Chrome 下发的
// quarantine，用来复现「Chrome 拉起 Agent 解出原生库」的现场。
func probeDylib(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	src := filepath.Join(dir, "probe.c")
	if err := os.WriteFile(src, []byte("int probe(void) { return 42; }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "probe.dylib")
	if out, err := exec.Command("clang", "-dynamiclib", "-o", path, src).CombinedOutput(); err != nil {
		t.Skipf("本机没有可用的 clang，跳过：%v %s", err, out)
	}
	if out, err := exec.Command("xattr", "-w", "com.apple.quarantine", probeQuarantine, path).CombinedOutput(); err != nil {
		t.Skipf("本机不允许设置 quarantine，跳过：%v %s", err, out)
	}
	if quarantineOf(path) == "" {
		t.Skip("quarantine 没有写进去，环境不支持该用例")
	}
	return path
}

// TestSweepClearsQuarantine 走生产路径（sweep → walkSignable → trustFile），
// 断言带隔离的原生库被收拾干净且签名仍然有效。
func TestSweepClearsQuarantine(t *testing.T) {
	path := probeDylib(t)
	sweep([]string{filepath.Dir(path)})
	if q := quarantineOf(path); q != "" {
		t.Fatalf("sweep 之后仍有 quarantine: %q", q)
	}
	if out, err := exec.Command("codesign", "--verify", "--verbose=0", path).CombinedOutput(); err != nil {
		t.Fatalf("sweep 之后签名校验失败：%v %s", err, out)
	}
}

// TestClearThenSignIsNotEnough 是修复前顺序的回归锁：先 xattr -cr 再
// codesign，只要当前进程的启动链自己带隔离（例如 Chrome 启动的 Host），
// 这次写入就会把 quarantine 重新盖上。本地 Terminal 起的 `go test` 不在这条
// 隔离链上，复现不出来，因此这种情况跳过而不是失败。
func TestClearThenSignIsNotEnough(t *testing.T) {
	path := probeDylib(t)
	if out, err := exec.Command("xattr", "-cr", path).CombinedOutput(); err != nil {
		t.Fatalf("xattr -cr: %v %s", err, out)
	}
	if q := quarantineOf(path); q != "" {
		t.Fatalf("xattr -cr 之后仍有 quarantine: %q", q)
	}
	if out, err := exec.Command("codesign", "--force", "--sign", "-", path).CombinedOutput(); err != nil {
		t.Fatalf("codesign: %v %s", err, out)
	}
	if q := quarantineOf(path); q == "" {
		t.Skip("当前进程不在隔离链上，写文件不会被盖章；请在 Chrome 启动的 Host 里跑这条用例")
	}
}
