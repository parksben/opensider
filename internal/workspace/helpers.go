package workspace

import (
	"encoding/base64"
	"strings"
	"time"
	"unicode"
)

func trimSpace(s string) string { return strings.TrimSpace(s) }

func isoStamp() string {
	s := time.Now().UTC().Format(time.RFC3339Nano)
	s = strings.ReplaceAll(s, ":", "-")
	s = strings.ReplaceAll(s, ".", "-")
	return s
}

func sanitizeName(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	return b.String()
}

func hasJPEGExt(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg")
}

func decodeBase64(s string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(s)
}
