// Package log 只做一件事：把 Host 的一行日志追加到 ~/.opensider/host.log。
//
// 这个文件是排障入口（doctor 与安装 skill 都按它判断 Chrome 有没有真正拉起 Host），
// 但 Host 常常一挂就是几天、每条页面命令都写几行，所以不能让它无限涨：单文件超过
// MaxBytes 或跨过本机日期就切片，只保留最近 MaxFiles 份历史。正在写的那份路径永不
// 变，这样既有文档里的 `tail -n 12 ~/.opensider/host.log` 一直有效。
package log

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/parksben/opensider/internal/paths"
)

const (
	// 单个日志文件的上限。超过就把当前文件切走，重新开一份空的接着写。
	MaxBytes = 2 << 20
	// 保留的历史片份数（不含正在写的 host.log）。
	MaxFiles = 5
	// 切片失败后的退避时间（文件被别的程序占着改不了名时，不要每行都重试）。
	rotateRetry = 60 * time.Second
)

var (
	mu sync.Mutex
	// rotateBlockedUntil 非零时表示上次切片失败，在此之前不再尝试。
	rotateBlockedUntil time.Time
)

// Log 追加一行日志。写不进去就静默放弃——日志不该影响任何功能。
func Log(message string) {
	line := "[" + time.Now().UTC().Format(time.RFC3339Nano) + "] " + message + "\n"
	mu.Lock()
	defer mu.Unlock()
	p := paths.HostLogPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return
	}
	rotateIfNeeded(p, int64(len(line)), time.Now())
	f, err := os.OpenFile(p, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	_, _ = f.WriteString(line)
	_ = f.Close()
}

// rotateIfNeeded 按大小和日期决定要不要切片：当前文件加上即将写入的这一行会超过
// MaxBytes，或文件里记的还是「昨天」（本机时区），就把 host.log 改名成
// host.log.<时间戳>，再修剪历史片。
func rotateIfNeeded(p string, incoming int64, now time.Time) {
	if !rotateBlockedUntil.IsZero() && now.Before(rotateBlockedUntil) {
		return
	}
	info, err := os.Stat(p)
	if err != nil || info.Size() == 0 {
		return
	}
	// 已经明显超限时也要切（例如单行特别长），所以两个条件分开判。
	if info.Size()+incoming <= MaxBytes && sameDay(info.ModTime(), now) {
		return
	}
	stamp := info.ModTime().Local().Format("20060102-150405")
	target := p + "." + stamp
	for attempt := 1; ; attempt++ {
		if _, err := os.Stat(target); err != nil {
			break
		}
		target = p + "." + stamp + "-" + strconv.Itoa(attempt)
	}
	if err := os.Rename(p, target); err != nil {
		// 文件被占住（Windows 上很常见）时先放着，别把写日志拖慢。
		rotateBlockedUntil = now.Add(rotateRetry)
		return
	}
	pruneRotated(p, MaxFiles)
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Local().Date()
	by, bm, bd := b.Local().Date()
	return ay == by && am == bm && ad == bd
}

// pruneRotated 只留最近 keep 份历史片：文件名里的时间戳是定长且字典序可比的，
// 所以按名字排序就是按时间排序；只删多出来的那几个，不做任何解析重活。
func pruneRotated(p string, keep int) {
	dir := filepath.Dir(p)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	prefix := filepath.Base(p) + "."
	var names []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), prefix) {
			continue
		}
		names = append(names, entry.Name())
	}
	if len(names) <= keep {
		return
	}
	sort.Strings(names)
	for _, name := range names[:len(names)-keep] {
		_ = os.Remove(filepath.Join(dir, name))
	}
}
