package workspace

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/parksben/opensider/internal/paths"
)

func encode(s string) string { return base64.StdEncoding.EncodeToString([]byte(s)) }

func TestSaveUploadedPlainFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	items, err := SaveUploaded("notes.txt", "", encode("hello"))
	if err != nil {
		t.Fatalf("SaveUploaded: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one item, got %d: %+v", len(items), items)
	}
	if items[0].Kind != "file" || items[0].Name != "notes.txt" {
		t.Fatalf("unexpected item %+v", items[0])
	}
	if !strings.HasPrefix(items[0].Path, paths.UploadsDir()+string(os.PathSeparator)) {
		t.Fatalf("item does not live under uploads/: %q", items[0].Path)
	}
	raw, err := os.ReadFile(items[0].Path)
	if err != nil || string(raw) != "hello" {
		t.Fatalf("content mismatch: %q %v", raw, err)
	}
}

func TestSaveUploadedFolderFileReturnsFolderOnce(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	first, err := SaveUploaded("src/a.ts", "proj", encode("a"))
	if err != nil {
		t.Fatalf("SaveUploaded: %v", err)
	}
	if len(first) != 2 {
		t.Fatalf("expected folder + file on the first write, got %+v", first)
	}
	if first[0].Kind != "folder" || first[0].Name != "proj" {
		t.Fatalf("expected a folder item first, got %+v", first[0])
	}
	if want := filepath.Join(paths.UploadsDir(), "proj", "src", "a.ts"); first[1].Path != want {
		t.Fatalf("expected %q, got %q", want, first[1].Path)
	}

	second, err := SaveUploaded("src/b.ts", "proj", encode("b"))
	if err != nil {
		t.Fatalf("SaveUploaded: %v", err)
	}
	if len(second) != 1 || second[0].Kind != "file" {
		t.Fatalf("expected just the file the second time, got %+v", second)
	}
}

func TestSaveUploadedRejectsEscapeAndBadInput(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cases := []struct {
		name string
		arg  string
		dir  string
	}{
		{"dotdot", "../evil.txt", ""},
		{"dotdot nested", "a/../../evil.txt", ""},
		{"dotdot dir", "a.txt", "../evil"},
		{"absolute", "/etc/passwd", ""},
		{"empty", "", ""},
		{"windows escape", "..\\evil.txt", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := SaveUploaded(tc.arg, tc.dir, encode("x")); err == nil {
				t.Fatalf("expected %q/%q to be rejected", tc.dir, tc.arg)
			}
		})
	}

	if _, err := SaveUploaded("a.txt", "", ""); err == nil {
		t.Fatal("expected an empty payload to be rejected")
	}
	if _, err := SaveUploaded("a.txt", "", strings.Repeat("A", 800_001)); err == nil {
		t.Fatal("expected an oversized payload to be rejected")
	}
	// Nothing may have been written outside uploads/.
	entries, err := os.ReadDir(paths.UploadsDir())
	if err == nil {
		for _, entry := range entries {
			if entry.Name() == "evil.txt" || entry.Name() == "passwd" {
				t.Fatalf("escape wrote %q", entry.Name())
			}
		}
	}
}

func TestSaveUploadedKeepsBothCopiesOfADuplicateName(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	first, err := SaveUploaded("same.txt", "", encode("one"))
	if err != nil {
		t.Fatalf("SaveUploaded: %v", err)
	}
	second, err := SaveUploaded("same.txt", "", encode("two"))
	if err != nil {
		t.Fatalf("SaveUploaded: %v", err)
	}
	if first[0].Path == second[0].Path {
		t.Fatalf("expected the second write to take a new name, both were %q", first[0].Path)
	}
	if raw, _ := os.ReadFile(first[0].Path); string(raw) != "one" {
		t.Fatalf("first file was overwritten: %q", raw)
	}
}
