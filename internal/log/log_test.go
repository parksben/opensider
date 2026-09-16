package log

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/parksben/opensider/internal/paths"
)

// sandboxHome 把 ~/.opensider 指到一个临时目录：日志测试绝不能碰用户自己的 host.log。
func sandboxHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	dir := filepath.Join(home, ".opensider")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	rotateBlockedUntil = time.Time{}
	t.Cleanup(func() { rotateBlockedUntil = time.Time{} })
	return dir
}

func readLog(t *testing.T, p string) string {
	t.Helper()
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(data)
}

func rotated(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir %s: %v", dir, err)
	}
	var names []string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "host.log.") {
			names = append(names, entry.Name())
		}
	}
	return names
}

func TestKeepsWritingToTheSameFileBelowTheLimit(t *testing.T) {
	dir := sandboxHome(t)
	p := paths.HostLogPath()
	for i := 0; i < 20; i++ {
		Log("line")
	}
	body := readLog(t, p)
	if got := strings.Count(body, "line"); got != 20 {
		t.Fatalf("want 20 lines in host.log, got %d", got)
	}
	if names := rotated(t, dir); len(names) != 0 {
		t.Fatalf("nothing should have rotated yet, got %v", names)
	}
}

func TestRotatesWhenTheFileWouldExceedTheLimit(t *testing.T) {
	dir := sandboxHome(t)
	p := paths.HostLogPath()
	if err := os.WriteFile(p, []byte(strings.Repeat("x", MaxBytes)), 0o644); err != nil {
		t.Fatal(err)
	}
	Log("after rotation")

	names := rotated(t, dir)
	if len(names) != 1 {
		t.Fatalf("want exactly one rotated file, got %v", names)
	}
	if size := len(readLog(t, filepath.Join(dir, names[0]))); size != MaxBytes {
		t.Fatalf("rotated file should hold the old bytes, got %d", size)
	}
	if body := readLog(t, p); !strings.Contains(body, "after rotation") || strings.Contains(body, "xxx") {
		t.Fatalf("live log should only hold the new line, got %q", body)
	}
}

func TestRotatesWhenTheDayChanges(t *testing.T) {
	dir := sandboxHome(t)
	p := paths.HostLogPath()
	Log("yesterday")
	yesterday := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(p, yesterday, yesterday); err != nil {
		t.Fatal(err)
	}
	Log("today")

	names := rotated(t, dir)
	if len(names) != 1 {
		t.Fatalf("want a new day to rotate, got %v", names)
	}
	if body := readLog(t, filepath.Join(dir, names[0])); !strings.Contains(body, "yesterday") {
		t.Fatalf("rotated file should hold yesterday's line, got %q", body)
	}
	if body := readLog(t, p); strings.Contains(body, "yesterday") || !strings.Contains(body, "today") {
		t.Fatalf("live log should only hold today's line, got %q", body)
	}
}

func TestRotationKeepsAtMostMaxFilesAndKeepsEveryLine(t *testing.T) {
	dir := sandboxHome(t)
	p := paths.HostLogPath()
	// 造出比上限更多的历史片 + 一份满的当前文件，再写一行触发切片。
	for i := 0; i < MaxFiles+3; i++ {
		name := filepath.Join(dir, "host.log.2026010"+string(rune('0'+i%10))+"-000000")
		if err := os.WriteFile(name, []byte("old"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	Log("marker")
	for i := 0; i < 6; i++ {
		if err := os.WriteFile(p, []byte(strings.Repeat("y", MaxBytes)), 0o644); err != nil {
			t.Fatal(err)
		}
		Log("marker" + string(rune('0'+i)))
	}

	names := rotated(t, dir)
	if len(names) > MaxFiles {
		t.Fatalf("want at most %d rotated files, got %d (%v)", MaxFiles, len(names), names)
	}
	// 切片不能丢行：最近写的都在当前文件里。
	body := readLog(t, p)
	if !strings.Contains(body, "marker5") {
		t.Fatalf("live log lost the newest lines: %q", body)
	}
}

func TestRotationFailureBacksOffAndStillLogs(t *testing.T) {
	dir := sandboxHome(t)
	p := paths.HostLogPath()
	if err := os.WriteFile(p, []byte(strings.Repeat("z", MaxBytes)), 0o644); err != nil {
		t.Fatal(err)
	}
	// 目录只读：改名会失败（真实世界里是 Windows 上文件被别的程序占着），
	// 但文件本身仍可追加——写日志必须照常，且不能每写一行都重试一次改名。
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

	Log("still logged")

	if body := readLog(t, p); !strings.Contains(body, "still logged") {
		t.Fatalf("logging must survive a failed rotation, got %q", body)
	}
	if rotateBlockedUntil.IsZero() {
		t.Fatal("a failed rotation should back off instead of retrying every line")
	}
	if names := rotated(t, dir); len(names) != 0 {
		t.Fatalf("a failed rotation must not leave half-rotated files: %v", names)
	}
}
