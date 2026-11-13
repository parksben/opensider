package preview

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

var tinyPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
	0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

func TestReadRejectsRelativeAndRemote(t *testing.T) {
	if _, _, err := Read(""); !errors.Is(err, ErrEmpty) {
		t.Fatalf("empty: %v", err)
	}
	if _, _, err := Read("relative/photo.png"); !errors.Is(err, ErrAbsolute) {
		t.Fatalf("relative: %v", err)
	}
	if _, _, err := Read("https://example.com/a.png"); !errors.Is(err, ErrRemote) {
		t.Fatalf("https: %v", err)
	}
	if _, _, err := Read("file:///tmp/a.png"); !errors.Is(err, ErrRemote) {
		t.Fatalf("file url: %v", err)
	}
}

func TestReadRejectsDirectoryAndNonImage(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := Read(dir); !errors.Is(err, ErrNotFile) {
		t.Fatalf("dir: %v", err)
	}
	text := filepath.Join(dir, "note.txt")
	if err := os.WriteFile(text, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Read(text); !errors.Is(err, ErrNotImage) {
		t.Fatalf("text: %v", err)
	}
}

func TestReadPNG(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dot.png")
	if err := os.WriteFile(path, tinyPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	mime, data, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if mime != "image/png" {
		t.Fatalf("mime: %s", mime)
	}
	if len(data) != len(tinyPNG) {
		t.Fatalf("size: %d", len(data))
	}
}

func TestReadSVG(t *testing.T) {
	path := filepath.Join(t.TempDir(), "icon.svg")
	if err := os.WriteFile(path, []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>`), 0o644); err != nil {
		t.Fatal(err)
	}
	mime, _, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	if mime != "image/svg+xml" {
		t.Fatalf("mime: %s", mime)
	}
}

func TestEncodeChunksStayUnderNativeLimit(t *testing.T) {
	raw := make([]byte, ChunkBytes+120)
	for i := range raw {
		raw[i] = byte(i)
	}
	chunks := EncodeChunks(raw)
	if len(chunks) != 2 {
		t.Fatalf("chunks: %d", len(chunks))
	}
	var joined []byte
	for _, chunk := range chunks {
		part, err := base64.StdEncoding.DecodeString(chunk)
		if err != nil {
			t.Fatal(err)
		}
		joined = append(joined, part...)
	}
	if len(joined) != len(raw) {
		t.Fatalf("roundtrip %d", len(joined))
	}
	for _, chunk := range chunks {
		if 200+len(chunk) > 1024*1024 {
			t.Fatalf("chunk too large for native messaging: %d", len(chunk))
		}
	}
}

func TestReadFileKeepsTextMIME(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name string
		body string
		want string
	}{
		{"note.md", "# hello\n", "text/markdown; charset=utf-8"},
		{"data.json", `{"a":1}`, "application/json; charset=utf-8"},
		{"page.html", "<h1>hi</h1>", "text/html; charset=utf-8"},
		{"main.go", "package main\n", "text/plain; charset=utf-8"},
		{"unknown.bin", "plain text", "text/plain; charset=utf-8"},
	}
	for _, tc := range cases {
		path := filepath.Join(dir, tc.name)
		if err := os.WriteFile(path, []byte(tc.body), 0o644); err != nil {
			t.Fatal(err)
		}
		mime, data, err := ReadFile(path)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if mime != tc.want {
			t.Fatalf("%s mime = %q, want %q", tc.name, mime, tc.want)
		}
		if string(data) != tc.body {
			t.Fatalf("%s data = %q", tc.name, data)
		}
	}
}

func TestReadFilePDFAndImage(t *testing.T) {
	dir := t.TempDir()
	pdf := filepath.Join(dir, "doc.pdf")
	if err := os.WriteFile(pdf, []byte("%PDF-1.7\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if mime, _, err := ReadFile(pdf); err != nil || mime != "application/pdf" {
		t.Fatalf("pdf: mime=%q err=%v", mime, err)
	}
	png := filepath.Join(dir, "dot.png")
	if err := os.WriteFile(png, tinyPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	if mime, _, err := ReadFile(png); err != nil || mime != "image/png" {
		t.Fatalf("png: mime=%q err=%v", mime, err)
	}
	heic := filepath.Join(dir, "photo.heic")
	if err := os.WriteFile(heic, []byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	if mime, _, err := ReadFile(heic); err != nil || mime != "image/heic" {
		t.Fatalf("heic: mime=%q err=%v", mime, err)
	}
}

func TestReadFileRejectsDirectoryAndOversize(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := ReadFile(dir); !errors.Is(err, ErrNotFile) {
		t.Fatalf("dir: %v", err)
	}
	huge := filepath.Join(dir, "huge.bin")
	file, err := os.Create(huge)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(MaxBytes + 1); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadFile(huge); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversize: %v", err)
	}
}
