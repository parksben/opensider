package reveal

import (
	"errors"
	"path/filepath"
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
