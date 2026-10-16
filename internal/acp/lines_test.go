package acp

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestReadLinesHandlesLinesBeyondOldScannerCap(t *testing.T) {
	huge := strings.Repeat("a", 10*1024*1024)
	input := "first\n" + huge + "\nlast"
	var got []string
	readLines(strings.NewReader(input), func(line []byte) {
		got = append(got, strings.TrimSpace(string(line)))
	})
	if len(got) != 3 {
		t.Fatalf("want 3 lines, got %d", len(got))
	}
	if got[0] != "first" || len(got[1]) != len(huge) || got[2] != "last" {
		t.Fatalf("lines not preserved: %q / %d / %q", got[0], len(got[1]), got[2])
	}
}

func TestSlimUpdateTruncatesInlineImagePayloads(t *testing.T) {
	data := strings.Repeat("A", 5*1024*1024)
	update := map[string]any{
		"sessionUpdate": "tool_call_update",
		"title":         "cover.png",
		"content": []any{
			map[string]any{"type": "content", "content": map[string]any{"type": "image", "data": data}},
		},
		"rawOutput": map[string]any{
			"attachments": []any{map[string]any{"url": "data:image/png;base64," + data}},
		},
	}
	slimUpdate(update)
	if update["title"] != "cover.png" {
		t.Fatalf("short strings must stay intact")
	}
	inner := update["content"].([]any)[0].(map[string]any)["content"].(map[string]any)
	if got := inner["data"].(string); len(got) > maxUpdateString {
		t.Fatalf("content data not truncated: %d", len(got))
	}
	url := update["rawOutput"].(map[string]any)["attachments"].([]any)[0].(map[string]any)["url"].(string)
	if len(url) > maxUpdateString || !strings.Contains(url, "truncated") {
		t.Fatalf("attachment url not truncated: %d", len(url))
	}
}

func TestSlimStringKeepsUTF8Valid(t *testing.T) {
	s := strings.Repeat("中", maxUpdateString)
	got := slimString(s)
	if !utf8.ValidString(got) {
		t.Fatalf("truncation split a multi-byte rune")
	}
}
