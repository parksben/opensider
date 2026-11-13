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

// probeMachO 造一个真实的小体积 Mach-O。clang 产出的是 linker-signed
// 二进制，和 uv 解包出来的 .so 一样过不了 codesign --verify --strict。
func probeMachO(t *testing.T, path string) {
	t.Helper()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(dir, "probe.c")
	if err := os.WriteFile(src, []byte("int probe(void) { return 42; }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("clang", "-dynamiclib", "-o", path, src).CombinedOutput(); err != nil {
		t.Skipf("本机没有可用的 clang，跳过：%v %s", err, out)
	}
}

// probeDylib 造一个真实的小体积 Mach-O dylib 并打上 Chrome 下发的
// quarantine，用来复现「Chrome 拉起 Agent 解出原生库」的现场。
func probeDylib(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "probe.dylib")
	probeMachO(t, path)
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

func TestHermesRuntimeRoots(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".hermes")
	t.Setenv("HERMES_HOME", root)
	roots := hermesRuntimeRoots()
	want := map[string]bool{
		filepath.Join(root, "tools"):                     true,
		filepath.Join(root, "installs"):                  true,
		filepath.Join(root, "cache", "uv", "archive-v0"): true,
		filepath.Join(root, "cache", "uv", "wheels-v7"):  true,
	}
	if len(roots) != len(want) {
		t.Fatalf("roots = %v, want %d", roots, len(want))
	}
	for _, root := range roots {
		if !want[root] {
			t.Fatalf("unexpected root %q", root)
		}
	}
}

// TestHermesRuntimeTrustsNativeModules 覆盖 uv 解包出的 .so：它没有
// quarantine，只有 com.apple.provenance 和 linker-signed 签名，Gatekeeper
// 只认 codesign 补出来的有效签名。
func TestHermesRuntimeTrustsNativeModules(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".hermes")
	t.Setenv("HERMES_HOME", root)
	path := filepath.Join(root, "installs", "env", "venv", "lib", "python3.14",
		"site-packages", "pydantic_core", "_pydantic_core.cpython-314-darwin.so")
	probeMachO(t, path)
	if out, err := exec.Command("codesign", "--verify", "--strict", path).CombinedOutput(); err == nil {
		t.Skipf("clang 产出已经带有效签名，无法验证补签路径：%s", out)
	}
	trustHermesRuntime()
	if out, err := exec.Command("codesign", "--verify", "--strict", path).CombinedOutput(); err != nil {
		t.Fatalf("trustHermesRuntime 后签名校验失败：%v %s", err, out)
	}
}

// TestDisableCharSetNormalizerNative locks the fallback behavior: the native
// cd/md modules are moved aside so Python loads cd.py/md.py, and a dependency
// sync that restores a .so cannot bring the Gatekeeper prompt back.
func TestDisableCharSetNormalizerNative(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "charset_normalizer")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name string) string {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(name), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}
	cd := write("cd.cpython-314-darwin.so")
	md := write("md.cpython-314-darwin.so")
	other := write("other.cpython-314-darwin.so")
	fallback := write("cd.py")

	disableCharSetNormalizerNative([]string{root})
	for _, path := range []string{cd, md} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("%s still exists", path)
		}
		if _, err := os.Stat(path + ".opensider-disabled"); err != nil {
			t.Fatalf("%s was not moved aside: %v", path, err)
		}
	}
	for _, path := range []string{other, fallback} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s should stay: %v", path, err)
		}
	}

	write("cd.cpython-314-darwin.so")
	disableCharSetNormalizerNative([]string{root})
	if _, err := os.Stat(cd); !os.IsNotExist(err) {
		t.Fatalf("restored %s should be removed", cd)
	}
}
