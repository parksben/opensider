package host

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/pick"
	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/watch"
)

const pageCommandTimeout = 30 * time.Second

func (h *Host) handleWorkspaceCommand(command protocol.BrowserCommand) {
	if command.Method != "reportArtifacts" {
		h.armPageCommandTimeout(command)
		msg := map[string]any{"type": "browser.command", "command": command}
		if sid := h.commandSessionID(); sid != "" {
			msg["sessionId"] = sid
		}
		h.send(msg)
		return
	}
	items, skipped := parseArtifactArgs(command.Args)
	errText := ""
	if len(items) == 0 && len(skipped) > 0 {
		errText = "no usable artifact paths: " + strings.Join(skipped, "; ")
	}
	result := protocol.BrowserResult{
		ID:     command.ID,
		OK:     errText == "",
		Method: command.Method,
		Data: map[string]any{
			"items":   items,
			"count":   len(items),
			"skipped": skipped,
		},
		Error: errText,
	}
	if writeErr := watch.WriteCommandResult(result); writeErr != nil {
		log.Log("reportArtifacts result: " + writeErr.Error())
	}
	msg := map[string]any{"type": "artifacts", "items": items}
	if sid := h.commandSessionID(); sid != "" {
		msg["sessionId"] = sid
	}
	h.send(msg)
	if errText != "" {
		log.Log("reportArtifacts: " + errText)
		return
	}
	log.Log(fmt.Sprintf("reportArtifacts count=%d session=%s", len(items), str(msg["sessionId"])))
}

func (h *Host) armPageCommandTimeout(command protocol.BrowserCommand) {
	h.mu.Lock()
	if h.pageCommandTimers == nil {
		h.pageCommandTimers = map[string]*time.Timer{}
	}
	if h.pageCommandSettled == nil {
		h.pageCommandSettled = map[string]bool{}
	}
	if t := h.pageCommandTimers[command.ID]; t != nil {
		t.Stop()
	}
	delete(h.pageCommandSettled, command.ID)
	id := command.ID
	method := command.Method
	h.pageCommandTimers[id] = time.AfterFunc(pageCommandTimeout, func() {
		if !h.settlePageCommand(id) {
			return
		}
		_ = watch.WriteCommandResult(protocol.BrowserResult{
			ID:     id,
			OK:     false,
			Method: method,
			Error:  "page command timed out waiting for the extension",
		})
		log.Log("page command timeout " + id)
	})
	h.mu.Unlock()
}

func (h *Host) settlePageCommand(id string) bool {
	if id == "" {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.pageCommandSettled == nil {
		h.pageCommandSettled = map[string]bool{}
	}
	if h.pageCommandSettled[id] {
		return false
	}
	h.pageCommandSettled[id] = true
	if t := h.pageCommandTimers[id]; t != nil {
		t.Stop()
		delete(h.pageCommandTimers, id)
	}
	return true
}

// commandSessionID 为工作区命令（browser 工具与 reportArtifacts）推断来源会话：
// 恰好一个进程在跑一轮时就是它；都没有在跑时，如果只有一个进程持有会话，
// 也认作它（收尾阶段的工具）。两个以上候选（多会话并行）或无法判断时返回空——
// 侧栏对空标注只会退回「选中 / 唯一运行中」启发式，标错会直接把内容串给别的会话。
func (h *Host) commandSessionID() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	running := ""
	runningCount := 0
	active := ""
	activeCount := 0
	for _, runtime := range h.runtimes {
		sid := runtime.client.GetSessionID()
		if sid == "" {
			continue
		}
		active = sid
		activeCount++
		if runtime.prompting {
			running = sid
			runningCount++
		}
	}
	if runningCount == 1 {
		return running
	}
	if runningCount == 0 && activeCount == 1 {
		return active
	}
	return ""
}

func parseArtifactArgs(args map[string]any) (items []protocol.AttachmentItem, skipped []string) {
	seen := map[string]bool{}
	add := func(raw, name string) {
		path, err := resolveArtifactPath(raw)
		if err != nil {
			skipped = append(skipped, raw+": "+err.Error())
			return
		}
		if seen[path] {
			return
		}
		seen[path] = true
		item := pick.ClassifyPath(path)
		if strings.TrimSpace(name) != "" {
			item.Name = strings.TrimSpace(name)
		}
		items = append(items, item)
	}
	if args == nil {
		return nil, nil
	}
	if files, ok := args["files"].([]any); ok {
		for _, entry := range files {
			switch item := entry.(type) {
			case string:
				add(item, "")
			case map[string]any:
				add(str(item["path"]), str(item["name"]))
			}
		}
	}
	if paths, ok := args["paths"].([]any); ok {
		for _, entry := range paths {
			if s, ok := entry.(string); ok {
				add(s, "")
			}
		}
	}
	if path, ok := args["path"].(string); ok && path != "" {
		add(path, str(args["name"]))
	}
	return items, skipped
}

func resolveArtifactPath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", fmt.Errorf("empty path")
	}
	if strings.HasPrefix(path, "file:") {
		return "", fmt.Errorf("file URLs are not allowed")
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(paths.WorkspaceDir(), path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(abs); err != nil {
		return "", err
	}
	return abs, nil
}
