package log

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/parksben/opensider/internal/paths"
)

var mu sync.Mutex

func Log(message string) {
	line := "[" + time.Now().UTC().Format(time.RFC3339Nano) + "] " + message + "\n"
	mu.Lock()
	defer mu.Unlock()
	p := paths.HostLogPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return
	}
	f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.WriteString(line)
	_ = f.Close()
}
