package host

import "testing"

func TestParseFormFieldsKeepsMappingOnly(t *testing.T) {
	fields := parseFormFields(map[string]any{
		"fields": []any{
			map[string]any{"index": float64(1), "label": "Email", "type": "email", "required": true, "value": "leak@example.com"},
			map[string]any{"selector": "#password", "label": "Password", "secret": true},
			// 没有任何定位信息：丢掉，别在侧栏画一个填不进去的框。
			map[string]any{"label": ""},
		},
	})
	if len(fields) != 2 {
		t.Fatalf("want 2 usable fields, got %d: %v", len(fields), fields)
	}
	if fields[0]["key"] != "f0" || fields[1]["key"] != "f1" {
		t.Fatalf("keys must be stable and positional: %v", fields)
	}
	if fields[0]["label"] != "Email" || fields[0]["required"] != true {
		t.Fatalf("first field lost its display info: %v", fields[0])
	}
	if fields[1]["secret"] != true || fields[1]["selector"] != "#password" {
		t.Fatalf("second field lost its locator/secret flag: %v", fields[1])
	}
	for _, field := range fields {
		if _, ok := field["value"]; ok {
			t.Fatalf("a value must never travel with the field mapping: %v", field)
		}
	}
}

func TestParseFormFieldsCapsAndClips(t *testing.T) {
	raw := make([]any, 0, 40)
	for i := 0; i < 40; i++ {
		raw = append(raw, map[string]any{"index": float64(i + 1), "label": "Field"})
	}
	fields := parseFormFields(map[string]any{"fields": raw})
	if len(fields) != maxUserFormFields {
		t.Fatalf("want the list capped at %d, got %d", maxUserFormFields, len(fields))
	}

	long := make([]byte, 400)
	for i := range long {
		long[i] = 'a'
	}
	clipped := parseFormFields(map[string]any{
		"fields": []any{map[string]any{"index": float64(1), "label": string(long)}},
	})
	if len(clipped[0]["label"].(string)) != 120 {
		t.Fatalf("labels are clipped to 120 chars, got %d", len(clipped[0]["label"].(string)))
	}
}

func TestSelectionStepsDedupeAndCap(t *testing.T) {
	run := &selectionRun{}
	if _, changed := run.noteStep("", "pending"); changed {
		t.Fatal("an empty title is not a step")
	}
	if steps, changed := run.noteStep("search", "pending"); !changed || len(steps) != 1 {
		t.Fatalf("first step should be recorded: %v %v", steps, changed)
	}
	if _, changed := run.noteStep("search", "pending"); changed {
		t.Fatal("the same title + status must not be pushed twice")
	}
	if steps, changed := run.noteStep("search", "completed"); !changed || steps[0].Status != "completed" {
		t.Fatalf("a status change updates the existing step: %v %v", steps, changed)
	}
	for i := 0; i < 12; i++ {
		run.noteStep(string(rune('a'+i)), "pending")
	}
	if len(run.steps) != 8 {
		t.Fatalf("the step list is capped at 8, got %d", len(run.steps))
	}
	if run.steps[len(run.steps)-1].Title != "l" {
		t.Fatalf("the newest step must stay: %v", run.steps)
	}
}

func TestSelectionSettlesOnce(t *testing.T) {
	run := &selectionRun{}
	if !run.settle() {
		t.Fatal("the first settle wins")
	}
	if run.settle() {
		t.Fatal("a terminal event must be sent once, not twice")
	}
}
