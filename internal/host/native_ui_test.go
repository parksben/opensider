package host

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/parksben/opensider/internal/paths"
)

// 事件要落盘成 Agent 能读的形状：每条带上 tabId / recordedAt，超过上限只留最近 50 条。
func TestHandleNativeUiAppendsAndTrims(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := &Host{}

	event := func(kind string) map[string]any {
		return map[string]any{
			"events": []any{
				map[string]any{"kind": kind, "message": "Delete the thing?", "at": 1, "url": "https://example.test/"},
			},
			"tabId": float64(7),
			"url":   "https://example.test/",
		}
	}

	h.handleNativeUi(event("confirm"))
	h.handleNativeUi(event("prompt"))

	raw, err := os.ReadFile(paths.NativeUIPath())
	if err != nil {
		t.Fatalf("native-ui file: %v", err)
	}
	var doc nativeUIDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(doc.Events) != 2 {
		t.Fatalf("expected 2 events, got %d", len(doc.Events))
	}
	if doc.Events[0]["kind"] != "confirm" || doc.Events[1]["kind"] != "prompt" {
		t.Fatalf("events out of order: %v", doc.Events)
	}
	if doc.Events[1]["tabId"] != float64(7) || doc.Events[1]["recordedAt"] == nil {
		t.Fatalf("host fields missing: %v", doc.Events[1])
	}
	if doc.UpdatedAt == "" {
		t.Fatal("updatedAt should be stamped")
	}

	for i := 0; i < nativeUIEventLimit+5; i++ {
		h.handleNativeUi(event("alert"))
	}
	raw, err = os.ReadFile(paths.NativeUIPath())
	if err != nil {
		t.Fatalf("native-ui file after trimming: %v", err)
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("decode after trimming: %v", err)
	}
	if len(doc.Events) != nativeUIEventLimit {
		t.Fatalf("expected the ring buffer to hold %d events, got %d", nativeUIEventLimit, len(doc.Events))
	}
	if doc.Events[len(doc.Events)-1]["kind"] != "alert" {
		t.Fatalf("newest event should be last: %v", doc.Events[len(doc.Events)-1])
	}
}

func TestHandleNativeUiIgnoresEmptyBatches(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	h := &Host{}
	h.handleNativeUi(map[string]any{"events": []any{}})
	h.handleNativeUi(map[string]any{})
	if _, err := os.Stat(paths.NativeUIPath()); err == nil {
		t.Fatal("nothing should be written for an empty batch")
	}
}
