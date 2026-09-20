package host

import (
	"strings"

	"github.com/parksben/opensider/internal/sessioncfg"
)

// 会话配置项（`mode` / `model` 之外的那些：推理档位 `thought_level`、模型开关
// `model_config`…）在 Host 侧的状态与推送。
//
// 与模式同一套纪律：
//  1. **只代理，不发明**。集合完全来自该引擎的会话广告（解析见 internal/sessioncfg），
//     发现不到就推空集合，让侧栏不画控件——宁可没有，也不要摆一个点了没反应的假菜单。
//  2. **用户选过的值优先**。pinnedOptions 是用户在侧栏显式选过的值（configId → value），
//     会话起来时由 acp 侧落下去；不合法/不再广告的值自动放弃（以引擎为准）。
//
// 两个已经有专属通道的类别不在这里重复推：`mode`（走 agentModes）与 `model`（走 models）——
// 同一份状态走两条线，只会在侧栏里多出一份可能不同步的副本。

func (h *Host) sendAgentOptions() {
	h.mu.Lock()
	options := pushableOptions(h.agentOptions)
	h.mu.Unlock()
	if options == nil {
		options = []sessioncfg.Option{}
	}
	h.send(map[string]any{"type": "agentOptions", "options": options})
}

// pushableOptions 去掉已有专属通道的类别，其余原样交给侧栏。侧栏只渲染它认识的两类
// （`thought_level` / `model_config`），不认识的类别照收不画——以后要加一类，Host 不用改。
func pushableOptions(options []sessioncfg.Option) []sessioncfg.Option {
	out := make([]sessioncfg.Option, 0, len(options))
	for _, option := range options {
		switch strings.ToLower(option.Category) {
		case sessioncfg.CategoryMode, sessioncfg.CategoryModel:
			continue
		}
		out = append(out, option)
	}
	return out
}

// refreshAgentOptions 从这个进程重新读配置项并推给侧栏。
func (h *Host) refreshAgentOptions(runtime *acpRuntime) {
	if runtime == nil || runtime.client == nil {
		return
	}
	options := runtime.client.SessionOptions()
	h.mu.Lock()
	h.agentOptions = options
	h.mu.Unlock()
	h.sendAgentOptions()
}

// setAgentOption 处理用户在侧栏选的配置项值。只作用于已持有该会话的进程（与 agent.setMode
// 同一套纪律：不去抢别的空闲进程做 session/load，那会静默换掉别人的会话绑定）。
func (h *Host) setAgentOption(configID, value, sessionID string) error {
	if configID == "" || value == "" {
		return nil
	}
	h.mu.Lock()
	if h.pinnedOptions == nil {
		h.pinnedOptions = map[string]string{}
	}
	h.pinnedOptions[configID] = value
	h.mu.Unlock()
	runtime := h.runtimeBySession(sessionID)
	if runtime == nil || runtime.client == nil {
		// 会话还没起来：先记住，下次开会话时 applySessionOptions 会补上。
		h.sendAgentOptions()
		return nil
	}
	runtime.client.SetPinnedOption(configID, value)
	h.refreshAgentOptions(runtime)
	return nil
}

// adoptPinnedOptions 把侧栏记住的选择交给所有 ACP 客户端：下次开会话时由
// applySessionOptions 应用（发现不到、或值不再合法就自动放弃，不会盲发）。
func (h *Host) adoptPinnedOptions(values map[string]string) {
	h.mu.Lock()
	h.pinnedOptions = values
	runtimes := append([]*acpRuntime{}, h.runtimes...)
	h.mu.Unlock()
	for _, runtime := range runtimes {
		if runtime.client != nil {
			runtime.client.SetPinnedOptions(values)
		}
	}
}

// resetAgentOptions 换 Agent 时清空配置项集合：它是每家引擎自己的，不能串。注意
// **别清用户的选择**（pinnedMode / pinnedOptions）——那两个是「按 Agent 记住」的，
// 侧栏在 agent.connect 里已经按新的 Agent 设置好了，这里清掉就把记忆抹了。
func (h *Host) resetAgentOptions() {
	h.mu.Lock()
	h.agentOptions = nil
	h.mu.Unlock()
}

// optionValuesFromAny 把侧栏传来的 `optionValues`（configId → value）收成字符串表。
func optionValuesFromAny(raw any) map[string]string {
	obj, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	out := map[string]string{}
	for configID, item := range obj {
		if configID == "" {
			continue
		}
		if value, ok := item.(string); ok && value != "" {
			out[configID] = value
		}
	}
	return out
}
