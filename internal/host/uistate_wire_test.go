package host

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/parksben/opensider/internal/uistate"
)

func TestSplitStateTextKeepsUTF8Boundaries(t *testing.T) {
	// 中文 3 字节、emoji 4 字节：切片只能落在字符边界，拼回来必须逐字节一致。
	text := strings.Repeat("会话状态🙂", 60_000)
	parts := splitStateText(text)
	if len(parts) < 2 {
		t.Fatalf("expected multiple chunks, got %d", len(parts))
	}
	if strings.Join(parts, "") != text {
		t.Fatal("chunks must rejoin losslessly")
	}
	for i, part := range parts {
		if len(part) > uiStateChunkBytes {
			t.Fatalf("chunk %d is %d bytes, over the %d limit", i, len(part), uiStateChunkBytes)
		}
		if !utf8.ValidString(part) {
			t.Fatalf("chunk %d split a utf-8 rune", i)
		}
	}
}

func TestUIStateMessagesChunkLargeState(t *testing.T) {
	big := map[string]any{"version": 1, "blob": strings.Repeat("x", uiStateSingleLimit+1000)}
	messages := uiStateMessages(big)
	if len(messages) < 2 {
		t.Fatalf("a state over the single-frame limit must be chunked, got %d message(s)", len(messages))
	}
	total := intFrom(messages[0]["total"])
	if total != len(messages) {
		t.Fatalf("total %d does not match %d messages", total, len(messages))
	}
	var joined strings.Builder
	for i, msg := range messages {
		if msg["type"] != "ui.state" {
			t.Fatalf("message %d has type %v", i, msg["type"])
		}
		if intFrom(msg["index"]) != i || intFrom(msg["total"]) != total {
			t.Fatalf("message %d carries the wrong index/total: %v", i, msg)
		}
		if _, hasState := msg["state"]; hasState {
			t.Fatal("chunk messages must not also carry the whole state")
		}
		joined.WriteString(str(msg["data"]))
	}
	var back map[string]any
	if err := json.Unmarshal([]byte(joined.String()), &back); err != nil {
		t.Fatalf("joined chunks are not valid json: %v", err)
	}
	if back["blob"] != big["blob"] {
		t.Fatal("the joined state does not match the original")
	}
}

func TestUIStateMessagesKeepSmallStateSingleFrame(t *testing.T) {
	small := map[string]any{"version": 1, "sessions": []any{}}
	messages := uiStateMessages(small)
	if len(messages) != 1 {
		t.Fatalf("a small state should stay one frame, got %d", len(messages))
	}
	if _, ok := messages[0]["state"]; !ok {
		t.Fatal("the single-frame message must carry the state")
	}
}

func TestAcceptStateSetAssemblesChunksOutOfOrder(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := &Host{}
	state := map[string]any{
		"version": 1,
		"savedAt": "2026-09-18T00:00:00Z",
		"sessions": []any{
			map[string]any{"id": "s1", "acpSessionId": "acp-1", "messages": []any{}},
		},
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	chunks := splitStateText(string(raw))
	// 分片由 `go handleExt` 的不同 goroutine 处理，到达顺序没有强保证：倒序投递。
	for i := len(chunks) - 1; i >= 0; i-- {
		h.acceptStateSet(map[string]any{
			"type": "ui.state.set", "index": i, "total": len(chunks), "data": chunks[i],
		})
	}
	got, ok := uistate.LoadMap()
	if !ok || !uistate.HasHistory(got) {
		t.Fatal("the chunked upload never reached the mirror")
	}
}

func TestAcceptStateSetKeepsSingleFramePath(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := &Host{}
	h.acceptStateSet(map[string]any{
		"type": "ui.state.set",
		"state": map[string]any{
			"version": 1,
			"sessions": []any{
				map[string]any{"id": "s1", "acpSessionId": "acp-1", "messages": []any{}},
			},
		},
	})
	got, ok := uistate.LoadMap()
	if !ok || !uistate.HasHistory(got) {
		t.Fatal("the single-frame upload never reached the mirror")
	}
}

func TestAcceptStateSetIgnoresIncompleteTransfer(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := &Host{}
	h.acceptStateSet(map[string]any{
		"type": "ui.state.set", "index": 0, "total": 3,
		"data": `{"version":1,"sessions":[{"id":"s1","acpSessionId":"acp-1"`,
	})
	if _, ok := uistate.LoadMap(); ok {
		t.Fatal("a half-arrived transfer must not touch the mirror")
	}
}
