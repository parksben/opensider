package models

import "testing"

func TestParseOpenCodeModelsReadsProviderSlashIDs(t *testing.T) {
	catalog := ParseOpenCodeModels("Models cache refreshed\nopencode/big-pickle\ndeepseek/deepseek-v4-flash\n")
	if len(catalog.Models) != 2 {
		t.Fatalf("got %d models: %#v", len(catalog.Models), catalog.Models)
	}
	if catalog.Models[0].ID != "opencode/big-pickle" || catalog.Models[0].Name != "opencode/big-pickle" {
		t.Fatalf("first model: %#v", catalog.Models[0])
	}
	if catalog.CurrentID != "opencode/big-pickle" {
		t.Fatalf("current %q", catalog.CurrentID)
	}
}

func TestParseAgentModelsIgnoresOpenCodeLines(t *testing.T) {
	catalog := ParseAgentModels("opencode/big-pickle\ndeepseek/deepseek-v4-flash\n")
	if len(catalog.Models) != 0 {
		t.Fatalf("agent parser must not invent names from OpenCode output: %#v", catalog.Models)
	}
}

func TestParseOpenCodeModelsSkipsNoise(t *testing.T) {
	catalog := ParseOpenCodeModels("Usage: opencode models\nnot-a-model\n{ \"verbose\": true }\nanthropic/claude-sonnet-4-6\n")
	if len(catalog.Models) != 1 || catalog.Models[0].ID != "anthropic/claude-sonnet-4-6" {
		t.Fatalf("got %#v", catalog.Models)
	}
}

func TestCatalogFromConfigOptionsPrefersPopulatedModel(t *testing.T) {
	catalog := CatalogFromConfigOptions([]ConfigOption{
		{ID: "model", Category: "model", CurrentValue: "x", Options: nil},
		{
			ID:           "model",
			Category:     "model",
			CurrentValue: "opencode/big-pickle",
			Options: []ConfigChoice{
				{Value: "opencode/big-pickle", Name: "OpenCode/Big Pickle"},
				{Value: "deepseek/deepseek-v4-flash", Name: "DeepSeek/V4 Flash"},
			},
		},
	})
	if len(catalog.Models) != 2 {
		t.Fatalf("got %d models", len(catalog.Models))
	}
	if catalog.CurrentID != "opencode/big-pickle" {
		t.Fatalf("current %q", catalog.CurrentID)
	}
}

func TestOptionsFromAnyAcceptsObjectMap(t *testing.T) {
	options := OptionsFromAny(map[string]any{
		"model": map[string]any{
			"id":           "model",
			"category":     "model",
			"currentValue": "opencode/big-pickle",
			"options": []any{
				map[string]any{"value": "opencode/big-pickle", "name": "OpenCode/Big Pickle"},
			},
		},
	})
	catalog := CatalogFromConfigOptions(options)
	if len(catalog.Models) != 1 || catalog.Models[0].ID != "opencode/big-pickle" {
		t.Fatalf("got %#v from %#v", catalog.Models, options)
	}
}

func TestCatalogFromSessionModelsAcceptsArray(t *testing.T) {
	catalog := CatalogFromSessionModels([]any{
		map[string]any{"modelId": "opencode/big-pickle", "name": "Big Pickle"},
	})
	if len(catalog.Models) != 1 || catalog.Models[0].ID != "opencode/big-pickle" {
		t.Fatalf("got %#v", catalog.Models)
	}
}

func TestMergeCatalogKeepsCLIWhenACPEmpty(t *testing.T) {
	base := ParseOpenCodeModels("opencode/big-pickle\n")
	merged := MergeCatalog(base, Catalog{})
	if len(merged.Models) != 1 {
		t.Fatalf("empty ACP overlay wiped CLI list: %#v", merged.Models)
	}
}

func TestListCLIModelsUnknownKindIsEmpty(t *testing.T) {
	catalog := ListCLIModels("/bin/true", "")
	if len(catalog.Models) != 0 {
		t.Fatalf("unknown kind must not invent models: %#v", catalog.Models)
	}
}
