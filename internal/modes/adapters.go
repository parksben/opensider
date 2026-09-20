package modes

import "github.com/parksben/opensider/internal/protocol"

// Adapter 是「某家 CLI 的差异」。**这是唯一允许写各家差异的地方**，只解决泛化路径
// （Discover）拿不到的两件事：权限档怎么表达、模式怎么归类。泛化能解决的都不许写进
// 来——适配器里每一条都得实测验证过，删掉就该能平滑回落到泛化。
type Adapter interface {
	// PolicyCandidates 返回某个权限档在这家对应的 mode id（按优先级）。
	// **只允许返回权限档类模式**（acceptEdits / bypassPermissions / agent-full-access
	// 之类）；返回 plan / build 这类工作流模式是错的，那等于替用户改工作流。
	// 这家没有权限档概念就返回 nil——那就只在客户端拦卡，不动 CLI。
	PolicyCandidates(policy protocol.AgentPolicy) []string

	// PermissionOption 返回某档对应的**独立权限配置项**（不是 mode 的那种），
	// 例如 copilot 的 `allow_all`（on/off）。没有这种项就返回 ok=false。
	// 注意：引擎广告里没有这个项时调用方不会发（见 Plan）。
	PermissionOption(policy protocol.AgentPolicy) (configID string, value string, ok bool)

	// Kind 覆盖泛化归类；不发表意见就返回 KindUnknown。
	Kind(id, name string) Kind
}

// genericAdapter 是默认适配器：什么都不特殊化，一切走泛化 + 关键词。
// 新增一家 CLI 时先什么都不写，然后拿真机 probe 的报文看泛化结果对不对，确实不对再
// 建一个窄适配器。
type genericAdapter struct{}

func (genericAdapter) PolicyCandidates(protocol.AgentPolicy) []string { return nil }

func (genericAdapter) PermissionOption(protocol.AgentPolicy) (string, string, bool) {
	return "", "", false
}

func (genericAdapter) Kind(string, string) Kind { return KindUnknown }

// adapters 只收「已实测」的差异。键是 detect.AgentProfile.ID。
var adapters = map[string]Adapter{
	"opencode": openCodeAdapter{},
	"cursor":   cursorAdapter{},
	"copilot":  copilotAdapter{},
	"claude":   claudeAdapter{},
	"codex":    codexAdapter{},
}

// AdapterFor 取某家 CLI 的适配器，没有就走泛化。
func AdapterFor(agentID string) Adapter {
	if adapter, ok := adapters[agentID]; ok {
		return adapter
	}
	return genericAdapter{}
}

// openCodeAdapter：1.18.31 实测——`session/new` **不带** `modes`，只在 configOptions
// 里给 `mode: build|plan`；`session/set_config_option` 可用，`session/set_mode` 不对。
// build / plan 是纯工作流（plan 会挡住写操作），**没有任何权限档概念**，所以权限档不推
// 模式——想「每次都问」不该把用户丢进计划模式。
type openCodeAdapter struct{}

func (openCodeAdapter) PolicyCandidates(protocol.AgentPolicy) []string { return nil }

func (openCodeAdapter) PermissionOption(protocol.AgentPolicy) (string, string, bool) {
	return "", "", false
}

func (openCodeAdapter) Kind(id, name string) Kind {
	switch id {
	case "build":
		return KindBuild
	case "plan":
		return KindPlan
	}
	return KindUnknown
}

// cursorAdapter：实测 `modes` = agent / plan / ask（裸字符串 id），`set_mode` 可用。
// 四个权限档都不推模式：agent / plan / ask 没有一个是权限档，真正的「允许一切」只在
// 咱们自己侧栏拦卡。
type cursorAdapter struct{}

func (cursorAdapter) PolicyCandidates(protocol.AgentPolicy) []string { return nil }

func (cursorAdapter) PermissionOption(protocol.AgentPolicy) (string, string, bool) {
	return "", "", false
}

func (cursorAdapter) Kind(id, name string) Kind {
	switch id {
	case "agent":
		return KindAgent
	case "plan":
		return KindPlan
	case "ask":
		return KindAsk
	}
	return KindUnknown
}

// copilotAdapter：1.0.82 实测——`modes` 是 URL 形式
// （…#agent / #plan / #autopilot），另有**独立**配置项
// `{id:"allow_all", category:"permissions", options:[on, off]}`。
// 这三档 mode 是工作流（autopilot 语义是「一直干到完」，不只是权限），所以权限档走
// allow_all 这个专门的权限项，不去动 mode。
type copilotAdapter struct{}

func (copilotAdapter) PolicyCandidates(protocol.AgentPolicy) []string { return nil }

func (copilotAdapter) PermissionOption(policy protocol.AgentPolicy) (string, string, bool) {
	switch policy {
	case protocol.PolicyAuto, protocol.PolicyUnattended:
		return "allow_all", "on", true
	case protocol.PolicyAsk:
		return "allow_all", "off", true
	default:
		// 「允许文件修改」在 copilot 这边没有对应档（allow_all 只能全开/全关），
		// 表达不了「只自动过编辑」，就不动它。
		return "", "", false
	}
}

func (copilotAdapter) Kind(id, name string) Kind {
	switch {
	case hasSuffix(id, "#agent"):
		return KindAgent
	case hasSuffix(id, "#plan"):
		return KindPlan
	case hasSuffix(id, "#autopilot"):
		return KindFullAccess
	}
	return KindUnknown
}

// claudeAdapter：0.73.0 实测——5 个 mode 且都带 `_meta.kind`
// （default/Manual=standard、acceptEdits=standard、plan=plan、auto=auto_review、
// bypassPermissions=full_access）。这家 mode 本身就兼着权限语义，所以权限档直接映射到
// 相应 mode（不碰 plan）。
type claudeAdapter struct{}

func (claudeAdapter) PolicyCandidates(policy protocol.AgentPolicy) []string {
	switch policy {
	case protocol.PolicyWorkspace:
		return []string{"acceptEdits"}
	case protocol.PolicyAuto:
		return []string{"auto"}
	case protocol.PolicyUnattended:
		return []string{"bypassPermissions"}
	default:
		// `ask` 不发：CLI 默认（default/Manual）就是每次都问，主动发反而多一次 RPC。
		return nil
	}
}

func (claudeAdapter) PermissionOption(protocol.AgentPolicy) (string, string, bool) {
	return "", "", false
}

func (claudeAdapter) Kind(id, name string) Kind {
	switch id {
	case "default":
		return KindAsk
	case "acceptEdits":
		return KindEdits
	case "plan":
		return KindPlan
	case "auto":
		return KindAuto
	case "bypassPermissions":
		return KindFullAccess
	}
	return KindUnknown
}

// codexAdapter：来自 codex-acp 的公开实现（**尚未真机复核**）——`modes` = read-only /
// agent / agent-full-access，另有独立的 `collaboration_mode`（default / plan）。
// 只映射最保守的两档：auto → agent（approve for me），unattended → agent-full-access。
// `ask` 不推 read-only：那会让 Codex 直接拒绝改文件，不是「先问再干」的意思。
type codexAdapter struct{}

func (codexAdapter) PolicyCandidates(policy protocol.AgentPolicy) []string {
	switch policy {
	case protocol.PolicyAuto:
		return []string{"agent"}
	case protocol.PolicyUnattended:
		return []string{"agent-full-access"}
	default:
		return nil
	}
}

func (codexAdapter) PermissionOption(protocol.AgentPolicy) (string, string, bool) {
	return "", "", false
}

func (codexAdapter) Kind(id, name string) Kind {
	switch id {
	case "read-only":
		return KindAsk
	case "agent":
		return KindAgent
	case "agent-full-access":
		return KindFullAccess
	}
	return KindUnknown
}

func hasSuffix(value, suffix string) bool {
	return len(value) >= len(suffix) && value[len(value)-len(suffix):] == suffix
}
