package host

import (
	"fmt"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/watch"
)

// 两条「把活儿交回给人」的命令。它们和 reportArtifacts 一样由 Host 自己消化，不转给扩展的
// 页面命令通道：
//
//   - `requestUserTakeover`：Agent 干不下去了（登录、验证码、必须本人确认），先交还标签接管，
//     再在侧栏提示用户。顺序很重要——握着标签页又让用户去点是点不动的。
//   - `requestUserInput`：账号 / 密码这类值**不许经过 Agent**。Agent 只给字段映射，值由用户在
//     侧栏填写、由扩展直接写进页面；Host 只拿到「填了哪些字段」。
const (
	userFormTimeout = 10 * time.Minute
	// maxUserFormFields 不是安全边界，只是防止一条命令把侧栏撑爆。
	maxUserFormFields = 20
)

type pendingForm struct {
	command   protocol.BrowserCommand
	sessionID string
	timer     *time.Timer
}

func (h *Host) handleUserTakeover(command protocol.BrowserCommand, sessionID string) {
	reason := clip(str(command.Args["reason"]), 300)
	resumeHint := clip(str(command.Args["resumeHint"]), 300)
	msg := map[string]any{"type": "takeover", "requestId": command.ID, "reason": reason, "resumeHint": resumeHint}
	if sessionID != "" {
		msg["sessionId"] = sessionID
	}
	// 先发这条：扩展收到它会就地释放该会话的标签接管（徽标 / banner / 页面活性），
	// 用户才能真的去操作那一页。
	h.send(msg)
	_ = watch.WriteCommandResult(protocol.BrowserResult{
		ID:     command.ID,
		OK:     true,
		Method: command.Method,
		Data:   map[string]any{"released": true},
	})
	log.Log("takeover requested " + command.ID)
}

func (h *Host) handleUserInput(command protocol.BrowserCommand, sessionID string) {
	fields := parseFormFields(command.Args)
	if len(fields) == 0 {
		errText := "no usable fields: give index, selector, or label for each one"
		_ = watch.WriteCommandResult(protocol.BrowserResult{
			ID:     command.ID,
			OK:     false,
			Method: command.Method,
			Error:  errText,
		})
		return
	}
	msg := map[string]any{
		"type":      "form.request",
		"requestId": command.ID,
		"title":     clip(str(command.Args["title"]), 120),
		"fields":    fields,
	}
	if sessionID != "" {
		msg["sessionId"] = sessionID
	}
	h.mu.Lock()
	if h.forms == nil {
		h.forms = map[string]*pendingForm{}
	}
	// 同一个 id 重复提交（Agent 改写命令文件）：旧的作废，只留最新这条。
	if old := h.forms[command.ID]; old != nil && old.timer != nil {
		old.timer.Stop()
	}
	entry := &pendingForm{command: command, sessionID: sessionID}
	entry.timer = time.AfterFunc(userFormTimeout, func() {
		h.settleForm(command.ID, false, nil, nil, "the user did not submit the form in time", false)
	})
	h.forms[command.ID] = entry
	h.mu.Unlock()
	h.send(msg)
	log.Log("form requested " + command.ID + fmt.Sprintf(" fields=%d", len(fields)))
}

// settleForm 收尾一张表单：写结果文件、清 pending。只认第一次调用。
func (h *Host) settleForm(requestID string, ok bool, filled, missing []string, errText string, cancelled bool) {
	h.mu.Lock()
	entry := h.forms[requestID]
	delete(h.forms, requestID)
	h.mu.Unlock()
	if entry == nil {
		return
	}
	if entry.timer != nil {
		entry.timer.Stop()
	}
	if cancelled {
		errText = "the user cancelled the form"
	}
	if filled == nil {
		filled = []string{}
	}
	if missing == nil {
		missing = []string{}
	}
	result := protocol.BrowserResult{
		ID:     entry.command.ID,
		OK:     ok,
		Method: entry.command.Method,
		Data: map[string]any{
			"filled":    filled,
			"missing":   missing,
			"cancelled": cancelled,
		},
		Error: errText,
	}
	if err := watch.WriteCommandResult(result); err != nil {
		log.Log("form result: " + err.Error())
	}
	log.Log(fmt.Sprintf("form settled %s ok=%v", requestID, ok))
}

// handleFormResult 收扩展回来的提交结果。值不在消息里（扩展只回字段名与计数），所以这里
// 也不会把值写进结果文件或日志。
func (h *Host) handleFormResult(msg map[string]any) {
	requestID := str(msg["requestId"])
	if requestID == "" {
		return
	}
	filled := stringList(msg["filled"])
	missing := stringList(msg["missing"])
	h.settleForm(requestID, msg["ok"] == true, filled, missing, str(msg["error"]), msg["cancelled"] == true)
}

// cancelFormsForSession 在一个会话被删掉 / 取消时收尾它挂着的表单，别让 Agent 干等。
func (h *Host) cancelFormsForSession(sessionID string) {
	if sessionID == "" {
		return
	}
	h.mu.Lock()
	ids := []string{}
	for id, entry := range h.forms {
		if entry.sessionID == sessionID {
			ids = append(ids, id)
		}
	}
	h.mu.Unlock()
	for _, id := range ids {
		h.settleForm(id, false, nil, nil, "", true)
	}
}

// parseFormFields 把 Agent 给的字段映射收成侧栏能渲染、扩展能回填的结构：
// key（取值用的稳定标识）+ 展示信息 + 定位信息。**不接受**任何预填值。
func parseFormFields(args map[string]any) []map[string]any {
	if args == nil {
		return nil
	}
	raw, _ := args["fields"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		if len(out) >= maxUserFormFields {
			break
		}
		item, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		index := intFrom(item["index"])
		selector := clip(str(item["selector"]), 400)
		label := clip(str(item["label"]), 120)
		name := clip(str(item["name"]), 120)
		if index == 0 && selector == "" && label == "" && name == "" {
			continue
		}
		field := map[string]any{
			"key":      fmt.Sprintf("f%d", len(out)),
			"required": item["required"] == true,
		}
		if index > 0 {
			field["index"] = index
		}
		if selector != "" {
			field["selector"] = selector
		}
		// label / name 二选一：label 是给用户看的，name 只用作页面定位。
		if label != "" {
			field["targetLabel"] = label
		} else if name != "" {
			field["targetLabel"] = name
		}
		display := clip(str(item["displayLabel"]), 120)
		if display == "" {
			display = label
		}
		if display == "" {
			display = name
		}
		if display == "" {
			display = fmt.Sprintf("Field %d", len(out)+1)
		}
		field["label"] = display
		if kind := clip(str(item["type"]), 20); kind != "" {
			field["type"] = kind
		}
		if placeholder := clip(str(item["placeholder"]), 120); placeholder != "" {
			field["placeholder"] = placeholder
		}
		if note := clip(str(item["note"]), 200); note != "" {
			field["note"] = note
		}
		if item["secret"] == true {
			field["secret"] = true
		}
		out = append(out, field)
	}
	return out
}

func stringList(v any) []string {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, text)
		}
	}
	return out
}

func clip(text string, limit int) string {
	text = strings.TrimSpace(text)
	if len(text) <= limit {
		return text
	}
	return strings.TrimSpace(text[:limit])
}
