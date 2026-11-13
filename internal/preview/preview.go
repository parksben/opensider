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
	"unicode/utf8"
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
	ErrTooLarge  = errors.New("file is too large to preview")
	ErrEmptyFile = errors.New("file is empty")
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

// fileMIMEByExt covers the types the artifact preview page can render without
// guessing. `http.DetectContentType` returns octet-stream for most source
// files, so the extension stays the primary signal for text-like content.
var fileMIMEByExt = map[string]string{
	".md":       "text/markdown; charset=utf-8",
	".markdown": "text/markdown; charset=utf-8",
	".txt":      "text/plain; charset=utf-8",
	".log":      "text/plain; charset=utf-8",
	".csv":      "text/csv; charset=utf-8",
	".tsv":      "text/tab-separated-values; charset=utf-8",
	".json":     "application/json; charset=utf-8",
	".jsonl":    "application/x-ndjson; charset=utf-8",
	".yaml":     "text/yaml; charset=utf-8",
	".yml":      "text/yaml; charset=utf-8",
	".toml":     "text/toml; charset=utf-8",
	".xml":      "application/xml; charset=utf-8",
	".html":     "text/html; charset=utf-8",
	".htm":      "text/html; charset=utf-8",
	".css":      "text/css; charset=utf-8",
	".js":       "text/javascript; charset=utf-8",
	".mjs":      "text/javascript; charset=utf-8",
	".cjs":      "text/javascript; charset=utf-8",
	".ts":       "text/plain; charset=utf-8",
	".tsx":      "text/plain; charset=utf-8",
	".jsx":      "text/plain; charset=utf-8",
	".go":       "text/plain; charset=utf-8",
	".py":       "text/plain; charset=utf-8",
	".rs":       "text/plain; charset=utf-8",
	".java":     "text/plain; charset=utf-8",
	".c":        "text/plain; charset=utf-8",
	".h":        "text/plain; charset=utf-8",
	".cpp":      "text/plain; charset=utf-8",
	".sh":       "text/plain; charset=utf-8",
	".sql":      "text/plain; charset=utf-8",
	".ini":      "text/plain; charset=utf-8",
	".conf":     "text/plain; charset=utf-8",
	".env":      "text/plain; charset=utf-8",
	".pdf":      "application/pdf",
	".mp3":      "audio/mpeg",
	".wav":      "audio/wav",
	".m4a":      "audio/mp4",
	".ogg":      "audio/ogg",
	".mp4":      "video/mp4",
	".webm":     "video/webm",
	".mov":      "video/quicktime",
}

func Read(raw string) (mime string, data []byte, err error) {
	path, data, err := readLocal(raw)
	if err != nil {
		return "", nil, err
	}
	mime, err = sniffMIME(path, data)
	if err != nil {
		return "", nil, err
	}
	return mime, data, nil
}

// ReadFile is the generic form used by the artifact preview page. Unlike Read
// it accepts text, PDF, audio and video; the caller decides whether the MIME is
// previewable. The byte cap and chunking stay identical to image preview so the
// native-messaging frame limit is never exceeded.
func ReadFile(raw string) (mime string, data []byte, err error) {
	path, data, err := readLocal(raw)
	if err != nil {
		return "", nil, err
	}
	return detectFileMIME(path, data), data, nil
}

func readLocal(raw string) (string, []byte, error) {
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
	data, err := os.ReadFile(path)
	if err != nil {
		return "", nil, err
	}
	if len(data) == 0 {
		return "", nil, ErrEmptyFile
	}
	if int64(len(data)) > MaxBytes {
		return "", nil, ErrTooLarge
	}
	return path, data, nil
}

func detectFileMIME(path string, data []byte) string {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".svg" || (ext == "" && looksLikeSVG(data)) {
		return "image/svg+xml"
	}
	detected := http.DetectContentType(data)
	if i := strings.IndexByte(detected, ';'); i >= 0 {
		detected = detected[:i]
	}
	if strings.HasPrefix(detected, "image/") ||
		strings.HasPrefix(detected, "audio/") ||
		strings.HasPrefix(detected, "video/") ||
		detected == "application/pdf" {
		return detected
	}
	if mime, ok := fileMIMEByExt[ext]; ok {
		return mime
	}
	if mime, ok := mimeByExt[ext]; ok {
		return mime
	}
	if strings.HasPrefix(detected, "text/") || utf8.Valid(data) {
		return "text/plain; charset=utf-8"
	}
	return "application/octet-stream"
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
