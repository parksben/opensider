package preview

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	MaxBytes   = 32 << 20
	ChunkBytes = 512 << 10
)

var (
	ErrEmpty     = errors.New("empty path")
	ErrRemote    = errors.New("refusing remote url")
	ErrAbsolute  = errors.New("path must be absolute")
	ErrNotFile   = errors.New("not a regular file")
	ErrNotImage  = errors.New("not an image")
	ErrTooLarge  = errors.New("image is too large to preview")
	ErrEmptyFile = errors.New("image is empty")
)

var mimeByExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
	".bmp":  "image/bmp",
	".ico":  "image/x-icon",
	".heic": "image/heic",
	".heif": "image/heif",
	".tif":  "image/tiff",
	".tiff": "image/tiff",
	".avif": "image/avif",
	".jxl":  "image/jxl",
}

func Read(raw string) (mime string, data []byte, err error) {
	path, err := cleanLocalPath(raw)
	if err != nil {
		return "", nil, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", nil, err
	}
	if !info.Mode().IsRegular() {
		return "", nil, ErrNotFile
	}
	if info.Size() <= 0 {
		return "", nil, ErrEmptyFile
	}
	if info.Size() > MaxBytes {
		return "", nil, ErrTooLarge
	}
	data, err = os.ReadFile(path)
	if err != nil {
		return "", nil, err
	}
	if len(data) == 0 {
		return "", nil, ErrEmptyFile
	}
	if int64(len(data)) > MaxBytes {
		return "", nil, ErrTooLarge
	}
	mime, err = sniffMIME(path, data)
	if err != nil {
		return "", nil, err
	}
	return mime, data, nil
}

func EncodeChunks(data []byte) []string {
	if len(data) == 0 {
		return nil
	}
	total := (len(data) + ChunkBytes - 1) / ChunkBytes
	out := make([]string, 0, total)
	for i := 0; i < len(data); i += ChunkBytes {
		end := i + ChunkBytes
		if end > len(data) {
			end = len(data)
		}
		out = append(out, base64.StdEncoding.EncodeToString(data[i:end]))
	}
	return out
}

func cleanLocalPath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" || path == "." {
		return "", ErrEmpty
	}
	if strings.Contains(path, "://") || looksRemote(path) {
		return "", ErrRemote
	}
	path = filepath.Clean(path)
	if !filepath.IsAbs(path) {
		return "", ErrAbsolute
	}
	return path, nil
}

func looksRemote(path string) bool {
	lower := strings.ToLower(path)
	return strings.HasPrefix(lower, "http:") ||
		strings.HasPrefix(lower, "https:") ||
		strings.HasPrefix(lower, "data:") ||
		strings.HasPrefix(lower, "blob:")
}

func sniffMIME(path string, data []byte) (string, error) {
	detected := http.DetectContentType(data)
	if i := strings.IndexByte(detected, ';'); i >= 0 {
		detected = detected[:i]
	}
	if strings.HasPrefix(detected, "image/") {
		return detected, nil
	}
	if looksLikeSVG(data) {
		return "image/svg+xml", nil
	}
	ext := strings.ToLower(filepath.Ext(path))
	mime := mimeByExt[ext]
	if mime != "" && (detected == "application/octet-stream" || detected == "") {
		return mime, nil
	}
	return "", fmt.Errorf("%w: %s", ErrNotImage, detected)
}

func looksLikeSVG(data []byte) bool {
	s := strings.TrimLeftFunc(string(data), unicode.IsSpace)
	if s == "" {
		return false
	}
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "<?xml") {
		if i := strings.Index(lower, "<svg"); i >= 0 && i < 1024 {
			return true
		}
		return false
	}
	return strings.HasPrefix(lower, "<svg")
}
