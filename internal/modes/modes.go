// Package modes 管「Agent 自己的会话模式」（plan / build / ask / autopilot / yolo…）：
// 从会话广告里发现有哪些模式、把模式归类成 UI 用的 Kind、并决定用哪个 ACP 配置项去改。
//
// 与 internal/acp 的分工：acp 只管取报文和发 RPC，本包只做**纯逻辑**，不依赖任何
// 进程或管道，好在表格化数据上直接写单测。
//
// 为什么要有这一层：各家 mode 的 id **没有任何统一标准**——cursor 是裸字符串
// （agent / plan / ask），copilot 是 URL（…/session-modes#plan），opencode 干脆不给
// `modes` 字段、只在 configOptions 里给 `mode: build|plan`。靠字符串相等匹配必然散成
// 一堆 if。所以：
//
//  1. 规范能解决的（Config Options 优先于 Session Modes、只认 value/name/description）
//     全部走 Discover 这一条泛化路径；
//  2. 规范解决不了的各家差异**只允许**写进 adapters.go，而且要实测验证过；
//  3. 认不出来就老实说「不知道」（Kind unknown / 没有 Target），UI 那边对应的表现是
//     不画控件，而不是拿猜测的 id 去砸 RPC。
package modes

import (
	"strings"

	"github.com/parksben/opensider/internal/protocol"
)

// Source 说明这个会话的模式是用哪种机制表达的。规范里 Config Options 已经取代
// Session Modes（`modes` 会在未来版本移除），所以两者都在时只认 config 那一路。
type Source string

const (
	// SourceConfig 表示模式是 configOptions 里的一项（id/category 为 mode）。
	SourceConfig Source = "config"
	// SourceModes 表示走旧的 `modes.availableModes` / `session/set_mode`。
	SourceModes Source = "modes"
)

// Kind 是模式的语义分类，**只用来给 UI 挑图标**（不影响任何行为），所以猜错的代价
// 只是图标不准。
type Kind string

const (
	KindPlan       Kind = "plan"        // 先出计划再动手
	KindBuild      Kind = "build"       // 正常干活
	KindAsk        Kind = "ask"         // 每步都问
	KindAgent      Kind = "agent"       // 通用对话 / 默认
	KindEdits      Kind = "edits"       // 自动接受文件修改
	KindAuto       Kind = "auto"        // 自动决策权限
	KindFullAccess Kind = "full_access" // 放开一切 / 无人值守
	KindUnknown    Kind = "unknown"     // 认不出来
)

// Option 是 Agent 广告出来的一个模式值，字段与 ACP 一一对应（id ← value/id，
// name 与 description 原样透传，不做翻译）。
type Option struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Desc string `json:"desc,omitempty"`
	Kind Kind   `json:"kind"`
}

// Target 是一个「可以切换」的完整描述：用哪种机制、改哪个配置项、当前值是什么、
// 有哪些可选值。没有 Target 就等于「这个 CLI 没有可切换的模式」。
type Target struct {
	Source   Source
	ConfigID string // 仅 SourceConfig 有意义，通常是 "mode"
	Current  string
	Options  []Option
}

// Has 报告某个 id 是否真的在这个会话广告过的集合里。发任何设置前都要先过这一关：
// 盲发未广告的 id 是这套协议里最容易把会话弄坏的操作。
func (t Target) Has(id string) bool {
	for _, opt := range t.Options {
		if opt.ID == id {
			return true
		}
	}
	return false
}

// Name 返回某个 id 的显示名（找不到就退回 id 本身）。
func (t Target) Name(id string) string {
	for _, opt := range t.Options {
		if opt.ID == id {
			if opt.Name != "" {
				return opt.Name
			}
			return opt.ID
		}
	}
	return id
}

// Discover 是唯一的泛化发现入口：给 `session/new|load|fork` 或 `config_option_update`
// 里的原始字段，吐出可切换的模式集合。
//
// 取值顺序照规范：先 configOptions 里 category=mode 的项（其次 id/configId=mode），
// 没有再退回旧的 `modes`。少于两项就算「没有可切换的模式」——一项的时候切换没有意义，
// 与其画一个只有一个选项的下拉，不如不画。
func Discover(agentID string, configOptions any, legacy any) (Target, bool) {
	adapter := AdapterFor(agentID)
	if opt, ok := modeConfigOption(configOptions); ok {
		options := parseChoices(opt["options"])
		if len(options) < 2 {
			return Target{}, false
		}
		current := str(opt["currentValue"])
		if current == "" {
			current = str(opt["value"])
		}
		return Target{
			Source:   SourceConfig,
			ConfigID: optionID(opt),
			Current:  current,
			Options:  classifyAll(adapter, options),
		}, true
	}
	return fromLegacyModes(adapter, legacy)
}

// HasConfigOption 报告某个独立配置项（例如 copilot 的 `allow_all`）是否真被广告。
// 权限档要在这种项上表达时，必须先过这一关，否则又是一次盲发。
func HasConfigOption(configOptions any, configID string) bool {
	for _, opt := range configOptionList(configOptions) {
		if optionID(opt) == configID {
			return true
		}
	}
	return false
}

// modeConfigOption 挑出表达 mode 的那个配置项。category 是规范给的语义标记，优先用它；
// 有的老实现不带 category，才退回按 id/configId 判断。
func modeConfigOption(configOptions any) (map[string]any, bool) {
	list := configOptionList(configOptions)
	for _, opt := range list {
		if strings.EqualFold(str(opt["category"]), "mode") {
			return opt, true
		}
	}
	for _, opt := range list {
		if optionID(opt) == "mode" {
			return opt, true
		}
	}
	return nil, false
}

func fromLegacyModes(adapter Adapter, legacy any) (Target, bool) {
	var current string
	var raw any
	switch value := legacy.(type) {
	case map[string]any:
		current = str(value["currentModeId"])
		if current == "" {
			current = str(value["currentMode"])
		}
		if value["availableModes"] != nil {
			raw = value["availableModes"]
		} else if value["modes"] != nil {
			raw = value["modes"]
		} else {
			raw = value
		}
	default:
		raw = legacy
	}
	options := parseChoices(raw)
	if len(options) < 2 {
		return Target{}, false
	}
	return Target{
		Source:  SourceModes,
		Current: current,
		Options: classifyAll(adapter, options),
	}, true
}

// parseChoices 把 ACP 的 options 数组摊平成 {id, name, desc}。规范允许分组
// （`{group, name, options:[…]}`），分组只影响排版，这里摊平即可——嵌套最多一层。
func parseChoices(v any) []Option {
	var out []Option
	seen := map[string]bool{}
	add := func(opt Option) {
		if opt.ID == "" || seen[opt.ID] {
			return
		}
		if opt.Name == "" {
			opt.Name = opt.ID
		}
		seen[opt.ID] = true
		out = append(out, opt)
	}
	for _, item := range asSlice(v) {
		switch entry := item.(type) {
		case string:
			add(Option{ID: strings.TrimSpace(entry)})
		case map[string]any:
			if nested, ok := entry["options"]; ok && entry["value"] == nil && entry["id"] == nil {
				for _, opt := range parseChoices(nested) {
					add(opt)
				}
				continue
			}
			add(Option{
				ID:   firstNonEmpty(str(entry["value"]), str(entry["id"])),
				Name: str(entry["name"]),
				Desc: str(entry["description"]),
			})
		}
	}
	return out
}

func classifyAll(adapter Adapter, options []Option) []Option {
	for i := range options {
		options[i].Kind = KindOf(adapter, "", options[i].ID, options[i].Name)
	}
	return options
}

// KindOf 归类一个模式。优先级：Agent 自己给的 `_meta.kind`（Codex / Claude 会带
// plan / auto_review / full_access / standard，虽然不是官方字段但比猜准）→ 该 CLI
// 适配器的显式表 → 保守的关键词启发式。
func KindOf(adapter Adapter, meta string, id string, name string) Kind {
	if kind := kindFromMeta(meta); kind != KindUnknown {
		return kind
	}
	if kind := adapter.Kind(id, name); kind != KindUnknown {
		return kind
	}
	return kindFromKeywords(id, name)
}

func kindFromMeta(meta string) Kind {
	switch strings.ToLower(strings.TrimSpace(meta)) {
	case "plan":
		return KindPlan
	case "auto_review":
		return KindAuto
	case "full_access":
		return KindFullAccess
	case "standard":
		// 「标准模式」不说明它到底干什么，交给 id / name 判断。
		return KindUnknown
	default:
		return KindUnknown
	}
}

// kindFromKeywords 只看 id 与 name 里的关键词，且按「越宽越靠前」的顺序判断——
// 顺序错了就会把 autopilot 归成 auto、把 agent-full-access 归成 agent。
func kindFromKeywords(id string, name string) Kind {
	hay := strings.ToLower(id + " " + name)
	has := func(words ...string) bool {
		for _, word := range words {
			if strings.Contains(hay, word) {
				return true
			}
		}
		return false
	}
	switch {
	case has("full-access", "full_access", "fullaccess", "bypass", "yolo", "allow-all", "allow_all", "autopilot", "unrestricted"):
		return KindFullAccess
	case has("plan", "architect"):
		return KindPlan
	case has("build", "implement"):
		return KindBuild
	case has("ask", "manual", "question"):
		return KindAsk
	case has("edit"):
		return KindEdits
	case has("auto"):
		return KindAuto
	case has("agent", "default", "standard"):
		return KindAgent
	default:
		return KindUnknown
	}
}

// IsPermissionKind 报告某个分类是不是「权限档」性质——这类模式可以被权限策略驱动；
// plan / build 这类工作流模式不行（那正是旧实现把「默认权限」变成 plan 的原因）。
func IsPermissionKind(kind Kind) bool {
	switch kind {
	case KindEdits, KindAuto, KindFullAccess:
		return true
	default:
		return false
	}
}

// Resolve 在候选 id 里挑第一个**真被广告过**的（没广告过一律不发）。
func Resolve(candidates []string, target Target) (string, bool) {
	for _, id := range candidates {
		if target.Has(id) {
			return id, true
		}
	}
	return "", false
}

func optionID(opt map[string]any) string {
	return firstNonEmpty(str(opt["id"]), str(opt["configId"]))
}

func configOptionList(configOptions any) []map[string]any {
	var out []map[string]any
	for _, item := range asSlice(configOptions) {
		if opt, ok := item.(map[string]any); ok {
			out = append(out, opt)
		}
	}
	if len(out) == 0 {
		// 有的实现把 configOptions 包在外层对象里。
		if wrapper, ok := configOptions.(map[string]any); ok {
			for _, item := range asSlice(wrapper["configOptions"]) {
				if opt, ok := item.(map[string]any); ok {
					out = append(out, opt)
				}
			}
		}
	}
	return out
}

func asSlice(v any) []any {
	if items, ok := v.([]any); ok {
		return items
	}
	return nil
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// PolicyPush 汇总「某个权限档该往 CLI 推什么」。空结果表示这家没有对应概念，
// 那就只在客户端拦卡（不猜、不发）。
type PolicyPush struct {
	ModeID      string // 要切的 mode id（已确认被广告过）
	ConfigID    string // 要改的独立配置项（如 copilot 的 allow_all）
	ConfigValue string
}

// Plan 算出把某个权限档表达成 CLI 侧设置的动作。`pinned` 是用户显式选过的模式：
// 一旦用户自己选了模式，权限档就不再覆盖它（但仍然会去动独立权限项——那个不是模式）。
func Plan(policy protocol.AgentPolicy, agentID string, target Target, hasTarget bool, configOptions any, pinned string) PolicyPush {
	adapter := AdapterFor(agentID)
	var push PolicyPush
	if pinned == "" && hasTarget {
		if candidates := adapter.PolicyCandidates(policy); len(candidates) > 0 {
			if id, ok := Resolve(candidates, target); ok && IsPermissionKind(kindOfID(target, id)) {
				push.ModeID = id
			}
		}
	}
	if configID, value, ok := adapter.PermissionOption(policy); ok && configID != "" {
		if HasConfigOption(configOptions, configID) {
			push.ConfigID = configID
			push.ConfigValue = value
		}
	}
	return push
}

func kindOfID(target Target, id string) Kind {
	for _, opt := range target.Options {
		if opt.ID == id {
			return opt.Kind
		}
	}
	return KindUnknown
}
