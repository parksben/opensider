package modes

import (
	"encoding/json"
	"testing"

	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/sessioncfg"
)

// 这里的 JSON 片段都是从真机 ACP probe 里原样抄回来的（2026-09-19 实测），
// 不是手写的理想报文——适配层最容易错的地方就是各家字段名的差异。

// opencode 1.18.31：不带 `modes`，只在 configOptions 里给 mode。
const openCodeSession = `{
  "sessionId": "ses_f4ab7d581ffeQI7UrtZFs027OL",
  "configOptions": [
    {"id": "model", "category": "model", "currentValue": "opencode/big-pickle", "options": [{"value": "opencode/big-pickle", "name": "Big Pickle"}]},
    {"id": "mode", "category": "mode", "currentValue": "build", "options": [
      {"value": "build", "name": "Build", "description": "The default agent."},
      {"value": "plan", "name": "Plan", "description": "Planning mode."}
    ]}
  ]
}`

// cursor-agent：裸字符串 id 的 modes，同时也有 mode 配置项（规范说配置项优先）。
const cursorSession = `{
  "sessionId": "s1",
  "modes": {"currentModeId": "agent", "availableModes": [
    {"id": "agent", "name": "Agent", "description": "Default agent"},
    {"id": "plan", "name": "Plan", "description": "Read-only planning"},
    {"id": "ask", "name": "Ask", "description": "Ask questions"}
  ]},
  "configOptions": [
    {"id": "mode", "category": "mode", "currentValue": "agent", "options": [
      {"value": "agent", "name": "Agent"},
      {"value": "plan", "name": "Plan"},
      {"value": "ask", "name": "Ask"}
    ]}
  ]
}`

// copilot 1.0.82：URL 形式的 mode id，外加独立的 allow_all 权限项。
const copilotSession = `{
  "sessionId": "s2",
  "modes": {"currentModeId": "https://agentclientprotocol.com/protocol/session-modes#agent", "availableModes": [
    {"id": "https://agentclientprotocol.com/protocol/session-modes#agent", "name": "Agent"},
    {"id": "https://agentclientprotocol.com/protocol/session-modes#plan", "name": "Plan"},
    {"id": "https://agentclientprotocol.com/protocol/session-modes#autopilot", "name": "Autopilot"}
  ]},
  "configOptions": [
    {"id": "mode", "category": "mode", "currentValue": "https://agentclientprotocol.com/protocol/session-modes#agent", "options": [
      {"value": "https://agentclientprotocol.com/protocol/session-modes#agent", "name": "Agent"},
      {"value": "https://agentclientprotocol.com/protocol/session-modes#plan", "name": "Plan"},
      {"value": "https://agentclientprotocol.com/protocol/session-modes#autopilot", "name": "Autopilot"}
    ]},
    {"id": "allow_all", "category": "permissions", "currentValue": "off", "options": [
      {"value": "on", "name": "On"}, {"value": "off", "name": "Off"}
    ]}
  ]
}`

// claude-agent-acp 0.73.0：5 个 mode，每个带 _meta.kind。
const claudeSession = `{
  "sessionId": "s3",
  "modes": {"currentModeId": "default", "availableModes": [
    {"id": "default", "name": "Manual", "description": "Always ask before making changes", "_meta": {"kind": "standard"}},
    {"id": "acceptEdits", "name": "Accept edits", "_meta": {"kind": "standard"}},
    {"id": "plan", "name": "Plan", "_meta": {"kind": "plan"}},
    {"id": "auto", "name": "Auto", "_meta": {"kind": "auto_review"}},
    {"id": "bypassPermissions", "name": "Bypass permissions", "_meta": {"kind": "full_access"}}
  ]},
  "configOptions": [
    {"id": "mode", "category": "mode", "currentValue": "default", "options": [
      {"value": "default", "name": "Manual"},
      {"value": "acceptEdits", "name": "Accept edits"},
      {"value": "plan", "name": "Plan"},
      {"value": "auto", "name": "Auto"},
      {"value": "bypassPermissions", "name": "Bypass permissions"}
    ]}
  ]
}`

// 只有一项的家（kimi 实测就只有 default）：切无可切。
const singleModeSession = `{
  "sessionId": "s4",
  "modes": {"currentModeId": "default", "availableModes": [{"id": "default", "name": "Default"}]}
}`

func decode(t *testing.T, raw string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("bad fixture: %v", err)
	}
	return out
}

func discover(t *testing.T, agentID, raw string) (Target, bool) {
	t.Helper()
	session := decode(t, raw)
	return Discover(agentID, sessioncfg.Parse(session["configOptions"]), session["modes"])
}

func TestDiscoverOpenCodeUsesConfigOption(t *testing.T) {
	target, ok := discover(t, "opencode", openCodeSession)
	if !ok {
		t.Fatal("opencode advertises build/plan through configOptions, expected a target")
	}
	if target.Source != SourceConfig || target.ConfigID != "mode" {
		t.Fatalf("want config source with configId=mode, got %+v", target)
	}
	if target.Current != "build" {
		t.Fatalf("want current build, got %q", target.Current)
	}
	if len(target.Options) != 2 || target.Options[0].ID != "build" || target.Options[1].ID != "plan" {
		t.Fatalf("unexpected options %+v", target.Options)
	}
	if target.Options[1].Kind != KindPlan {
		t.Fatalf("plan should classify as plan, got %q", target.Options[1].Kind)
	}
	// 模型项不能被当成模式项。
	if target.Has("opencode/big-pickle") {
		t.Fatal("model option leaked into the mode target")
	}
}

func TestDiscoverPrefersConfigOptionsOverLegacyModes(t *testing.T) {
	// 规范：两者都在时只用 configOptions，忽略 modes。
	target, ok := discover(t, "cursor", cursorSession)
	if !ok {
		t.Fatal("expected a target")
	}
	if target.Source != SourceConfig {
		t.Fatalf("spec says config options win, got source %q", target.Source)
	}
	if target.Current != "agent" || len(target.Options) != 3 {
		t.Fatalf("unexpected target %+v", target)
	}
}

func TestDiscoverLegacyOnlyModes(t *testing.T) {
	session := decode(t, `{"modes": {"currentModeId": "build", "availableModes": [
		{"id": "build", "name": "Build"}, {"id": "plan", "name": "Plan"}]}}`)
	target, ok := Discover("some-new-cli", sessioncfg.Parse(session["configOptions"]), session["modes"])
	if !ok {
		t.Fatal("expected a target from legacy modes")
	}
	if target.Source != SourceModes || target.Current != "build" {
		t.Fatalf("unexpected target %+v", target)
	}
}

func TestDiscoverRejectsSingleOptionAndNothing(t *testing.T) {
	if _, ok := discover(t, "kimi", singleModeSession); ok {
		t.Fatal("a single mode is not switchable, expected no target")
	}
	if _, ok := Discover("gemini", nil, nil); ok {
		t.Fatal("nothing advertised means no target")
	}
}

func TestKindClassification(t *testing.T) {
	target, _ := discover(t, "claude", claudeSession)
	want := map[string]Kind{
		"default":           KindAsk,
		"acceptEdits":       KindEdits,
		"plan":              KindPlan,
		"auto":              KindAuto,
		"bypassPermissions": KindFullAccess,
	}
	for _, opt := range target.Options {
		if want[opt.ID] != opt.Kind {
			t.Errorf("%s: want kind %q, got %q", opt.ID, want[opt.ID], opt.Kind)
		}
	}

	copilot, _ := discover(t, "copilot", copilotSession)
	kinds := map[string]Kind{}
	for _, opt := range copilot.Options {
		kinds[opt.ID] = opt.Kind
	}
	if kinds["https://agentclientprotocol.com/protocol/session-modes#plan"] != KindPlan {
		t.Fatalf("copilot url plan id should classify as plan: %+v", kinds)
	}
	if kinds["https://agentclientprotocol.com/protocol/session-modes#autopilot"] != KindFullAccess {
		t.Fatalf("copilot autopilot should classify as full access: %+v", kinds)
	}
}

// 回归守卫：这是用户报的问题本身——选「默认权限」不该把 opencode 切进 plan。
func TestPolicyNeverPushesWorkflowModes(t *testing.T) {
	target, has := discover(t, "opencode", openCodeSession)
	for _, policy := range []protocol.AgentPolicy{protocol.PolicyAsk, protocol.PolicyWorkspace, protocol.PolicyAuto, protocol.PolicyUnattended} {
		push := Plan(policy, "opencode", target, has, nil, "")
		if push.ModeID != "" {
			t.Fatalf("opencode has no permission modes, policy %q must not push %q", policy, push.ModeID)
		}
	}
}

func TestPolicyPushesPermissionModesWhenAdvertised(t *testing.T) {
	target, has := discover(t, "claude", claudeSession)
	cases := map[protocol.AgentPolicy]string{
		protocol.PolicyWorkspace:  "acceptEdits",
		protocol.PolicyAuto:       "auto",
		protocol.PolicyUnattended: "bypassPermissions",
		protocol.PolicyAsk:        "",
	}
	for policy, want := range cases {
		push := Plan(policy, "claude", target, has, nil, "")
		if push.ModeID != want {
			t.Errorf("policy %q: want mode %q, got %q", policy, want, push.ModeID)
		}
	}
}

func TestPolicyLeavesUserPinnedModeAlone(t *testing.T) {
	target, has := discover(t, "claude", claudeSession)
	push := Plan(protocol.PolicyUnattended, "claude", target, has, nil, "plan")
	if push.ModeID != "" {
		t.Fatalf("a pinned mode must win over the policy, got %q", push.ModeID)
	}
}

func TestPolicyUsesSeparatePermissionOption(t *testing.T) {
	session := decode(t, copilotSession)
	target, has := Discover("copilot", sessioncfg.Parse(session["configOptions"]), session["modes"])

	push := Plan(protocol.PolicyUnattended, "copilot", target, has, sessioncfg.Parse(session["configOptions"]), "")
	if push.ModeID != "" {
		t.Fatalf("copilot permissions live in allow_all, not the mode: %+v", push)
	}
	if push.ConfigID != "allow_all" || push.ConfigValue != "on" {
		t.Fatalf("want allow_all=on, got %+v", push)
	}

	ask := Plan(protocol.PolicyAsk, "copilot", target, has, sessioncfg.Parse(session["configOptions"]), "")
	if ask.ConfigID != "allow_all" || ask.ConfigValue != "off" {
		t.Fatalf("ask should turn allow_all off, got %+v", ask)
	}

	// 引擎没广告这个项就一律不发。
	if push := Plan(protocol.PolicyUnattended, "copilot", target, has, nil, ""); push.ConfigID != "" {
		t.Fatalf("must not send an unadvertised config option: %+v", push)
	}
}

func TestPolicySkipsUnadvertisedCandidates(t *testing.T) {
	// 某家适配器声明了 id，但这次会话没广告它——不能盲发。
	session := decode(t, `{"configOptions": [{"id": "mode", "category": "mode", "currentValue": "build", "options": [
		{"value": "build", "name": "Build"}, {"value": "plan", "name": "Plan"}]}]}`)
	target, has := Discover("claude", sessioncfg.Parse(session["configOptions"]), session["modes"])
	if push := Plan(protocol.PolicyUnattended, "claude", target, has, sessioncfg.Parse(session["configOptions"]), ""); push.ModeID != "" {
		t.Fatalf("bypassPermissions was not advertised, must not be sent: %+v", push)
	}
}

func TestIsPermissionKindSeparatesWorkflowFromPermission(t *testing.T) {
	if IsPermissionKind(KindPlan) || IsPermissionKind(KindBuild) {
		t.Fatal("plan/build are workflow modes, never a permission level")
	}
	for _, kind := range []Kind{KindEdits, KindAuto, KindFullAccess} {
		if !IsPermissionKind(kind) {
			t.Fatalf("%q should count as a permission kind", kind)
		}
	}
}
