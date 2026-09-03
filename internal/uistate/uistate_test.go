package uistate

import (
	"os"
	"path/filepath"
	"testing"
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
}
