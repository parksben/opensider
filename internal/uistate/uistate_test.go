package uistate

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSaveRefusesEmptyOverwrite(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	rich := map[string]any{
		"version": 1,
		"sessions": []any{
			map[string]any{
				"id": "s1",
				"messages": []any{
					map[string]any{"id": "m1", "role": "user", "content": []any{}},
				},
			},
		},
	}
	if err := Save(rich); err != nil {
		t.Fatal(err)
	}
	if err := Save(map[string]any{"version": 1, "sessions": []any{}}); err != nil {
		t.Fatal(err)
	}
	got, ok := LoadMap()
	if !ok || !HasHistory(got) {
		t.Fatal("empty save wiped history")
	}
}

func TestSaveCreatesFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	state := map[string]any{
		"version": 1,
		"locale":  "en",
		"sessions": []any{
			map[string]any{"id": "s1", "acpSessionId": "acp-1", "messages": []any{}},
		},
	}
	if err := Save(state); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, ".opensider", "ui-state.json")); err != nil {
		t.Fatal(err)
	}
	index := readIndex(t, filepath.Join(home, ".opensider", "ui-state.json"))
	if _, ok := sessionList(index["sessions"])[0]["messages"]; ok {
		t.Fatal("ui-state.json still carries messages")
	}
	body := readIndex(t, filepath.Join(home, ".opensider", "sessions", "s1.json"))
	if body["id"] != "s1" {
		t.Fatalf("session file id: %v", body["id"])
	}
}

func TestInlineHistoryIsBackedUpThenSplit(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	path := filepath.Join(home, ".opensider", "ui-state.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{
		"version": 1,
		"sessions": []any{
			map[string]any{
				"id": "legacy",
				"messages": []any{
					map[string]any{"id": "m1", "role": "user"},
					map[string]any{"id": "m2", "role": "assistant"},
				},
			},
		},
	})
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	got, ok := LoadMap()
	if !ok {
		t.Fatal("load failed")
	}
	if messages := sessionList(got["sessions"])[0]["messages"].([]any); len(messages) != 2 {
		t.Fatalf("legacy messages: %d", len(messages))
	}
	index := readIndex(t, path)
	if _, ok := sessionList(index["sessions"])[0]["messages"]; ok {
		t.Fatal("legacy file was not rewritten as an index")
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	var backup bool
	for _, entry := range entries {
		if strings.Contains(entry.Name(), "ui-state.json.sessions-backup-") {
			backup = true
		}
	}
	if !backup {
		t.Fatal("the inline history was not backed up before the split")
	}
}

func TestUnchangedTranscriptIsNotRewritten(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	state := map[string]any{
		"version": 1,
		"sessions": []any{
			map[string]any{"id": "s1", "updatedAt": "2026-01-01T00:00:00Z", "acpSessionId": "acp-1", "messages": []any{map[string]any{"id": "m1"}}},
		},
	}
	if err := Save(state); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, ".opensider", "sessions", "s1.json")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	old := info.ModTime()
	time.Sleep(20 * time.Millisecond)
	if err := Save(state); err != nil {
		t.Fatal(err)
	}
	info, err = os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(old) {
		t.Fatal("an unchanged session file was rewritten")
	}
}

func readIndex(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
