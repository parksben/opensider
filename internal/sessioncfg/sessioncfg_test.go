package sessioncfg

import (
	"encoding/json"
	"testing"
)

// 这些 payload 逐字抄自真机 probe（claude-agent-acp 0.73.0 / copilot 1.0.86 /
// opencode 1.18.31 / cursor），字段名不要改——解析层的容错就是针对这些形态写的。

const claudeSession = `{
  "sessionId": "s-1",
  "configOptions": [
    {"id": "mode", "name": "Mode", "category": "mode", "type": "select", "currentValue": "default",
     "options": [{"value": "default", "name": "Manual"}, {"value": "plan", "name": "Plan"}]},
    {"id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "default",
     "options": [{"value": "default", "name": "Default (recommended)"}, {"value": "opus[1m]", "name": "Opus (1M context)"}]},
    {"id": "effort", "name": "Effort", "category": "thought_level", "type": "select", "currentValue": "xhigh",
     "options": [{"value": "default", "name": "Default"}, {"value": "low", "name": "Low"},
                 {"value": "medium", "name": "Medium"}, {"value": "high", "name": "High"},
                 {"value": "xhigh", "name": "Xhigh"}, {"value": "max", "name": "Max"}]},
    {"id": "fast", "name": "Fast mode", "category": "model_config", "type": "boolean", "currentValue": false}
  ]
}`

// opencode 只给裸字符串可选值，而且不带 category。
const openCodeSession = `{
  "sessionId": "s-2",
  "configOptions": [
    {"id": "model", "name": "Model", "type": "select", "currentValue": "opencode/big-pickle",
     "options": [{"value": "opencode/big-pickle", "name": "OpenCode Zen/Big Pickle"}]},
    {"id": "mode", "name": "Session Mode", "type": "select", "currentValue": "build",
     "options": ["build", "plan"]}
  ]
}`

// copilot 的权限项：值名是它自己给的 On / Off，而值本身是 on / off 字符串。
const copilotSession = `{
  "sessionId": "s-3",
  "configOptions": [
    {"id": "allow_all", "name": "Allow All", "category": "permissions", "type": "select", "currentValue": "off",
     "options": [{"value": "on", "name": "On"}, {"value": "off", "name": "Off"}]}
  ]
}`

// cursor 的 model_config 是 select，值是字符串 "false" / "true"（不是布尔）。
const cursorSession = `{
  "sessionId": "s-4",
  "configOptions": [
    {"id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "composer-2.5",
     "options": [{"value": "composer-2.5", "name": "Composer 2.5"}]},
    {"id": "fast", "name": "Fast", "category": "model_config", "type": "select", "currentValue": "false",
     "options": [{"value": "false", "name": "Off"}, {"value": "true", "name": "Fast"}]}
  ]
}`

func parseSession(t *testing.T, raw string) []Option {
	t.Helper()
	var session map[string]any
	if err := json.Unmarshal([]byte(raw), &session); err != nil {
		t.Fatalf("bad fixture: %v", err)
	}
	return Parse(session["configOptions"])
}

func TestParseClaudeKeepsEveryOptionInOrder(t *testing.T) {
	options := parseSession(t, claudeSession)
	if len(options) != 4 {
		t.Fatalf("want 4 options, got %d: %+v", len(options), options)
	}
	// 规范说数组顺序即优先级，所以顺序必须原样保留。
	want := []string{"mode", "model", "effort", "fast"}
	for i, id := range want {
		if options[i].ID != id {
			t.Fatalf("position %d: want %q, got %q", i, id, options[i].ID)
		}
	}
	effort, ok := FirstOf(options, CategoryThoughtLevel)
	if !ok {
		t.Fatal("claude advertises a thought_level option")
	}
	if effort.Name != "Effort" || effort.Type != TypeSelect || effort.Current != "xhigh" {
		t.Fatalf("unexpected effort option: %+v", effort)
	}
	if len(effort.Values) != 6 || effort.Values[5].Name != "Max" {
		t.Fatalf("unexpected effort values: %+v", effort.Values)
	}
}

func TestParseBooleanCurrentValueIsStringified(t *testing.T) {
	options := parseSession(t, claudeSession)
	fast, ok := FirstOf(options, CategoryModelConfig)
	if !ok {
		t.Fatal("claude advertises a model_config option")
	}
	if !fast.IsBoolean() {
		t.Fatalf("want a boolean option, got type %q", fast.Type)
	}
	// 界面靠字符串比较，所以布尔当前值统一成 "true" / "false"。
	if fast.Current != "false" {
		t.Fatalf("want current=false, got %q", fast.Current)
	}
	if len(fast.Values) != 0 {
		t.Fatalf("boolean options carry no value list, got %+v", fast.Values)
	}
}

func TestWireValueMarksBooleans(t *testing.T) {
	options := parseSession(t, claudeSession)
	fast, _ := FirstOf(options, CategoryModelConfig)
	value, typ := fast.WireValue("true")
	// 规范要求布尔值必须带 type: "boolean"，否则引擎按字符串处理。
	if value != true || typ != TypeBoolean {
		t.Fatalf("want (true, boolean), got (%v, %q)", value, typ)
	}
	effort, _ := FirstOf(options, CategoryThoughtLevel)
	value, typ = effort.WireValue("max")
	if value != "max" || typ != "" {
		t.Fatalf("want (max, \"\"), got (%v, %q)", value, typ)
	}
}

func TestAcceptsOnlyAdvertisedValues(t *testing.T) {
	options := parseSession(t, claudeSession)
	effort, _ := FirstOf(options, CategoryThoughtLevel)
	if !effort.Accepts("max") || effort.Accepts("nope") {
		t.Fatalf("effort must only accept advertised values: %+v", effort.Values)
	}
	fast, _ := FirstOf(options, CategoryModelConfig)
	if !fast.Accepts("true") || !fast.Accepts("false") || fast.Accepts("yes") {
		t.Fatal("boolean options accept exactly true / false")
	}
}

func TestParseBareStringValuesAndMissingCategory(t *testing.T) {
	options := parseSession(t, openCodeSession)
	mode, ok := LookupMode(options)
	if !ok {
		t.Fatal("opencode's mode option has no category and must still be found by id")
	}
	if mode.Current != "build" || len(mode.Values) != 2 {
		t.Fatalf("unexpected mode option: %+v", mode)
	}
	// 裸字符串只给了 id，名字就退回 id（界面再决定怎么排版）。
	if mode.Values[1].ID != "plan" || mode.Values[1].Name != "plan" {
		t.Fatalf("bare string values keep their id as name: %+v", mode.Values)
	}
}

func TestParseCursorModelConfigSelect(t *testing.T) {
	options := parseSession(t, cursorSession)
	fast, ok := FirstOf(options, CategoryModelConfig)
	if !ok {
		t.Fatal("cursor advertises a model_config option")
	}
	if fast.IsBoolean() {
		t.Fatal("cursor's fast is a select with string values, not a boolean")
	}
	if fast.Current != "false" || fast.Values[1].Name != "Fast" {
		t.Fatalf("unexpected cursor fast: %+v", fast)
	}
	// 字符串值照样按字符串发，且不带 type。
	value, typ := fast.WireValue("true")
	if value != "true" || typ != "" {
		t.Fatalf("want (true, \"\"), got (%v, %q)", value, typ)
	}
	if !fast.Accepts("true") {
		t.Fatal("the advertised string value must be accepted")
	}
}

func TestParseCopilotPermissionOption(t *testing.T) {
	options := parseSession(t, copilotSession)
	option, ok := ByID(options, "allow_all")
	if !ok {
		t.Fatal("copilot's allow_all must be found by id")
	}
	if option.Category != CategoryPermission || option.Current != "off" {
		t.Fatalf("unexpected option: %+v", option)
	}
	if _, ok := LookupMode(options); ok {
		t.Fatal("allow_all is not a mode")
	}
	if _, ok := FirstOf(options, CategoryThoughtLevel); ok {
		t.Fatal("copilot 1.0.86 advertises no thought_level option")
	}
}

func TestLookupModePrefersCategoryOverID(t *testing.T) {
	// 同一次会话里若有别的项 id 里也带 mode，category 必须赢。
	options := Parse([]any{
		map[string]any{"id": "mode_extra", "category": "model_config", "type": "boolean"},
		map[string]any{"id": "session_mode", "category": "mode", "type": "select", "currentValue": "build"},
	})
	mode, ok := LookupMode(options)
	if !ok || mode.ID != "session_mode" {
		t.Fatalf("category=mode must win, got %+v", mode)
	}
}

func TestLookupModelFallsBackToID(t *testing.T) {
	options := parseSession(t, openCodeSession)
	model, ok := LookupModel(options)
	if !ok || model.ID != "model" {
		t.Fatalf("want the model option, got %+v", model)
	}
}

func TestParseAcceptsWrapperAndConfigIDAlias(t *testing.T) {
	// 实测见过的两种包装：数组被包在 {configOptions:[…]} 里，以及用 configId 而不是 id。
	options := Parse(map[string]any{
		"configOptions": []any{
			map[string]any{
				"configId":     "effort",
				"name":         "Effort",
				"category":     "thought_level",
				"type":         "select",
				"currentValue": "high",
				"options": []any{
					map[string]any{"value": "high", "name": "High"},
				},
			},
		},
	})
	if len(options) != 1 || options[0].ID != "effort" || options[0].Current != "high" {
		t.Fatalf("wrapper + configId alias must parse: %+v", options)
	}
}

func TestParseFlattensGroups(t *testing.T) {
	// 规范允许 options[] 里放分组（{group, name, options:[…]}），分组只影响排版。
	options := Parse([]any{
		map[string]any{
			"id": "effort", "category": "thought_level", "type": "select", "currentValue": "low",
			"options": []any{
				map[string]any{"group": "Common", "options": []any{
					map[string]any{"value": "default", "name": "Default"},
					map[string]any{"value": "low", "name": "Low"},
				}},
				map[string]any{"group": "Extended", "options": []any{
					map[string]any{"value": "max", "name": "Max"},
				}},
			},
		},
	})
	effort := options[0]
	if len(effort.Values) != 3 {
		t.Fatalf("groups must be flattened, got %+v", effort.Values)
	}
	if effort.Values[0].ID != "default" || effort.Values[2].ID != "max" {
		t.Fatalf("group order must be preserved: %+v", effort.Values)
	}
}

func TestParseIgnoresJunk(t *testing.T) {
	if options := Parse(nil); len(options) != 0 {
		t.Fatalf("nil must parse to nothing, got %+v", options)
	}
	if options := Parse([]any{"nonsense", 42, map[string]any{}}); len(options) != 0 {
		t.Fatalf("junk must be dropped, got %+v", options)
	}
}
