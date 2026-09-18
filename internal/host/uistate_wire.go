package host

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/native"
	"github.com/parksben/opensider/internal/uistate"
)

// Native Messaging 单帧上限 1MB（Chrome 对 Host→扩展方向是硬限制）。镜像状态随历史
// 增长迟早超过它，所以超过 uiStateSingleLimit 就改走分片：同一条 `ui.state` /
// `ui.state.set` 消息带 `{ index, total, data }` 逐片发，收发两端各自重组。
// 2026-09-18 的事故就是状态过 1MB 后单帧被两端各自丢弃，镜像既不落盘也灌不回。
//
// 尺寸口径：两个阈值都是**字节数**（发送前用 native.Marshal 的实际产物量）；
// 每片 256KB 原始文本嵌进消息后最多膨胀 2 倍（双转义 `"` 和 `\`），加上信封仍远低于
// 1MB，所以“永不超限”是构造出来的，不靠运气。
const (
	uiStateSingleLimit = 700 << 10
	uiStateChunkBytes  = 256 << 10
	maxStateChunks     = 4096
)

// uiStateMessages 把镜像状态切成要发送的消息序列：单帧装得下就发原样消息，
// 装不下才分片。分片切在 UTF-8 字符边界上，拼回来与原文逐字节一致。
func uiStateMessages(state map[string]any) []map[string]any {
	raw, err := native.Marshal(state)
	if err != nil {
		return []map[string]any{{"type": "ui.state", "state": nil}}
	}
	if len(raw) <= uiStateSingleLimit {
		return []map[string]any{{"type": "ui.state", "state": state}}
	}
	chunks := splitStateText(string(raw))
	out := make([]map[string]any, 0, len(chunks))
	for i, chunk := range chunks {
		out = append(out, map[string]any{
			"type":  "ui.state",
			"index": i,
			"total": len(chunks),
			"data":  chunk,
		})
	}
	return out
}

func splitStateText(text string) []string {
	if len(text) <= uiStateChunkBytes {
		return []string{text}
	}
	var out []string
	for start := 0; start < len(text); {
		end := start + uiStateChunkBytes
		if end >= len(text) {
			out = append(out, text[start:])
			break
		}
		for end > start && !utf8.RuneStart(text[end]) {
			end--
		}
		if end == start { // 防御性兜底：保证每轮至少前进一个字节
			end = start + uiStateChunkBytes
		}
		out = append(out, text[start:end])
		start = end
	}
	return out
}

// uiStateUpload 是一次进行中的分片上传（扩展 → Host 的 ui.state.set）。
// 分片消息由 `go handleExt` 的独立 goroutine 处理，到达顺序没有强保证，
// 所以按 index 归位、凑齐 total 片才拼；半截 JSON 永远不碰权威副本。
type uiStateUpload struct {
	total int
	parts map[int]string
}

// acceptStateSet 处理扩展来的镜像落盘：单帧形态直接保存，分片形态先攒后拼。
func (h *Host) acceptStateSet(msg map[string]any) {
	total := intFrom(msg["total"])
	if total <= 0 {
		h.saveSingleStateSet(msg)
		return
	}
	index := intFrom(msg["index"])
	data := str(msg["data"])
	if total > maxStateChunks || index < 0 || index >= total {
		log.Log(fmt.Sprintf("ui.state.set: bad chunk index=%d total=%d", index, total))
		return
	}
	h.mu.Lock()
	if h.stateUpload == nil || h.stateUpload.total != total {
		h.stateUpload = &uiStateUpload{total: total, parts: map[int]string{}}
	}
	h.stateUpload.parts[index] = data
	var joined string
	if len(h.stateUpload.parts) == total {
		parts := make([]string, total)
		for i := range parts {
			parts[i] = h.stateUpload.parts[i]
		}
		joined = strings.Join(parts, "")
		h.stateUpload = nil
	}
	h.mu.Unlock()
	if joined == "" {
		return
	}
	var state map[string]any
	if err := json.Unmarshal([]byte(joined), &state); err != nil {
		log.Log("ui.state.set: chunked state is not json: " + err.Error())
		return
	}
	log.Log(fmt.Sprintf("ui.state.set chunks=%d bytes=%d", total, len(joined)))
	if err := uistate.Save(state); err != nil {
		log.Log("ui.state.set: " + err.Error())
	}
}

func (h *Host) saveSingleStateSet(msg map[string]any) {
	var state map[string]any
	if raw, err := json.Marshal(msg["state"]); err == nil {
		_ = json.Unmarshal(raw, &state)
	}
	if err := uistate.Save(state); err != nil {
		log.Log("ui.state.set: " + err.Error())
	}
}
