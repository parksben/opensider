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
		h.send(map[string]any{"type": "browser.command", "command": command})
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
	if sid := h.promptingSessionID(); sid != "" {
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

func (h *Host) promptingSessionID() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, runtime := range h.runtimes {
		if runtime.prompting {
			if sid := runtime.client.GetSessionID(); sid != "" {
				return sid
			}
		}
	}
	for _, runtime := range h.runtimes {
		if sid := runtime.client.GetSessionID(); sid != "" {
			return sid
		}
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
