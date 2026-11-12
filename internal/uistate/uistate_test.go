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

func TestArchivedSessionKeepsTranscriptOnDisk(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	file := filepath.Join(home, ".opensider", "sessions", "s1.json")
	state := map[string]any{
		"version": 1,
		"sessions": []any{
			map[string]any{
				"id":        "s1",
				"updatedAt": "2026-01-01T00:00:00Z",
				"messages":  []any{map[string]any{"id": "m1", "role": "user"}},
			},
		},
	}
	if err := Save(state); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}

	archived := map[string]any{
		"version": 1,
		"sessions": []any{
			map[string]any{
				"id":         "s1",
				"updatedAt":  "2026-01-01T00:00:00Z",
				"archivedAt": "2026-02-01T00:00:00Z",
				"messages":   []any{},
			},
		},
	}
	if err := Save(archived); err != nil {
		t.Fatal(err)
	}

	// The index carries the archive flag, but the panel must not get the old body back.
	got, ok := LoadMap()
	if !ok {
		t.Fatal("load failed")
	}
	session := sessionList(got["sessions"])[0]
	if str(session["archivedAt"]) == "" {
		t.Fatal("archivedAt missing from the index")
	}
	if messages, _ := session["messages"].([]any); len(messages) != 0 {
		t.Fatalf("archived session was rehydrated: %d messages", len(messages))
	}

	after, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("archiving overwrote the transcript file")
	}
	body, ok := ReadSessionBody("s1")
	if !ok {
		t.Fatal("archived body is not readable")
	}
	if messages, _ := body["messages"].([]any); len(messages) != 1 {
		t.Fatalf("archived body messages: %d", len(messages))
	}
}

func TestArchiveSessionsMovesBodyOutOfTheIndex(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	file := filepath.Join(home, ".opensider", "sessions", "s1.json")
	state := map[string]any{
		"version": 1,
		"sessions": []any{
			map[string]any{
				"id":        "s1",
				"updatedAt": "2026-01-01T00:00:00Z",
				"messages":  []any{map[string]any{"id": "m1", "role": "user"}},
			},
			map[string]any{
				"id":        "s2",
				"updatedAt": "2026-01-02T00:00:00Z",
				"messages":  []any{map[string]any{"id": "m2", "role": "user"}},
			},
		},
	}
	if err := Save(state); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	// A session whose body never reached the disk must be refused, not archived.
	if err := os.Remove(filepath.Join(home, ".opensider", "sessions", "s2.json")); err != nil {
		t.Fatal(err)
	}

	archivedAt, archived, skipped, err := ArchiveSessions([]string{"s1", "s2"})
	if err != nil {
		t.Fatal(err)
	}
	if archivedAt == "" {
		t.Fatal("no archive timestamp")
	}
	if len(archived) != 1 || archived[0] != "s1" {
		t.Fatalf("archived = %v", archived)
	}
	if len(skipped) != 1 || skipped[0] != "s2" {
		t.Fatalf("skipped = %v", skipped)
	}

	got, ok := LoadMap()
	if !ok {
		t.Fatal("load failed")
	}
	byID := map[string]map[string]any{}
	for _, session := range sessionList(got["sessions"]) {
		byID[str(session["id"])] = session
	}
	if str(byID["s1"]["archivedAt"]) != archivedAt {
		t.Fatal("s1 is not archived in the index")
	}
	if messages, _ := byID["s1"]["messages"].([]any); len(messages) != 0 {
		t.Fatalf("s1 body stayed in the index: %d messages", len(messages))
	}
	if str(byID["s2"]["archivedAt"]) != "" {
		t.Fatal("s2 was archived without a body file")
	}
	after, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("archiving overwrote the transcript file")
	}
	if _, ok := ReadSessionBody("s1"); !ok {
		t.Fatal("archived body is not readable")
	}

	// An idempotent retry must still check the file: if it is gone, the panel must not
	// be told to clear its copy.
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if _, archivedAgain, skippedAgain, err := ArchiveSessions([]string{"s1"}); err != nil {
		t.Fatal(err)
	} else if len(archivedAgain) != 0 || len(skippedAgain) != 1 {
		t.Fatalf("archived = %v, skipped = %v", archivedAgain, skippedAgain)
	}
}
