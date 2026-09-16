package reveal

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestPathEmpty(t *testing.T) {
	if err := Path(""); err == nil || err.Error() != "empty path" {
		t.Fatalf("empty path: %v", err)
	}
	if err := Path("."); err == nil || err.Error() != "empty path" {
		t.Fatalf("dot path: %v", err)
	}
}

func TestPathMustBeAbsolute(t *testing.T) {
	if err := Path("relative/file.txt"); err == nil || err.Error() != "path must be absolute" {
		t.Fatalf("relative path: %v", err)
	}
}

func TestPathNotFound(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "gone.txt")
	err := Path(missing)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing file: %v", err)
	}
}

// Windows 上 explorer.exe 不按 CommandLineToArgvW 解析命令行，Go 拼参数时给整串加的
// 引号会让它认不出 /select 开关（老写法 `"/select,"+path` 拼出 `"/select,C:\a b\c.txt"`）。
// 断言开关留在引号外，路径单独加引号。
func TestExplorerSelectCmdLine(t *testing.T) {
	path := `C:\Users\John Smith\.opensider\workspace\outputs\report.html`
	line, ok := explorerSelectCmdLine(path)
	if !ok {
		t.Fatal("cmdline rejected")
	}
	if want := `explorer.exe /select,"` + path + `"`; line != want {
		t.Fatalf("cmdline = %q, want %q", line, want)
	}
	if !strings.HasPrefix(line, "explorer.exe /select,") {
		t.Fatalf("switch must stay outside the quotes: %q", line)
	}
	if strings.HasPrefix(line, `"`) {
		t.Fatalf("cmdline must not start with a quote (explorer reads it as a path): %q", line)
	}

	noSpace := `C:\Users\John\.opensider\workspace\outputs\report.html`
	if line, ok := explorerSelectCmdLine(noSpace); !ok || line != `explorer.exe /select,"`+noSpace+`"` {
		t.Fatalf("no-space path = %q ok=%v", line, ok)
	}
}

func TestExplorerSelectCmdLineRejectsUnsafeInput(t *testing.T) {
	for _, path := range []string{"", `C:\a"b\c.txt`} {
		if line, ok := explorerSelectCmdLine(path); ok {
			t.Fatalf("expected rejection for %q, got %q", path, line)
		}
	}
}
