package acp

import "testing"

func TestAdvertisedModeIDsFromOpenCodeConfig(t *testing.T) {
	opts := []any{
		map[string]any{"id": "model", "category": "model", "options": []any{map[string]any{"value": "opencode/big-pickle"}}},
		map[string]any{
			"id":           "mode",
			"category":     "mode",
			"currentValue": "build",
			"options": []any{
				map[string]any{"value": "build", "name": "build"},
				map[string]any{"value": "plan", "name": "plan"},
			},
		},
	}
	got := advertisedModeIDs(opts, nil)
	if len(got) != 2 || got[0] != "build" || got[1] != "plan" {
		t.Fatalf("got %#v", got)
	}
	if modeConfigID(opts) != "mode" {
		t.Fatalf("config id")
	}
}

func TestPickModeCandidatesIntersects(t *testing.T) {
	got := pickModeCandidates([]string{"bypassPermissions", "auto", "build"}, []string{"build", "plan"})
	if len(got) != 1 || got[0] != "build" {
		t.Fatalf("got %#v", got)
	}
	if pickModeCandidates([]string{"bypassPermissions"}, []string{"build", "plan"}) != nil {
		t.Fatal("unknown modes must be dropped")
	}
	got = pickModeCandidates([]string{"bypassPermissions", "auto"}, nil)
	if len(got) != 2 {
		t.Fatalf("no advertisement keeps wanted %#v", got)
	}
}
