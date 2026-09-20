package host

import (
	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/modes"
)

// 会话模式（Agent 自己的 plan / build / ask / autopilot…）在 Host 侧的状态与推送。
//
// 两条纪律：
//  1. **只代理，不发明**。模式集合完全来自该引擎的会话广告（见 internal/modes），
//     发现不到就推空集合，让侧栏不画控件——宁可没有，也不要摆一个点了没反应的假菜单。
//  2. **用户的选择优先于权限档**。pinnedMode 是用户在侧栏显式选过的模式；它一旦存在，
//     权限档就不再覆盖模式（权限档仍然照旧管客户端拦卡）。

func (h *Host) sendAgentModes() {
	h.mu.Lock()
	target := h.agentModes
	has := h.hasAgentModes
	pinned := h.pinnedMode
	h.mu.Unlock()
	options := target.Options
	if options == nil {
		options = []modes.Option{}
	}
	// available 是给侧栏的判据：少于两项等于没得切，控件不该出现。
	h.send(map[string]any{
		"type":      "agentModes",
		"source":    string(target.Source),
		"configId":  target.ConfigID,
		"currentId": target.Current,
		"options":   options,
		"pinned":    pinned,
		"available": has && len(options) > 1,
	})
}

// refreshAgentModes 从这个进程重新发现可切换的模式并推给侧栏。
func (h *Host) refreshAgentModes(runtime *acpRuntime) {
	if runtime == nil || runtime.client == nil {
		return
	}
	target, has := runtime.client.SessionModes()
	h.mu.Lock()
	h.agentModes = target
	h.hasAgentModes = has
	h.mu.Unlock()
	h.sendAgentModes()
}

// setAgentMode 处理用户在侧栏选的模式。只作用于已持有该会话的进程（与 model.set 同一套
// 纪律：不去抢别的空闲进程做 session/load，那会静默换掉别人的会话绑定）。
func (h *Host) setAgentMode(modeID, sessionID string) error {
	h.mu.Lock()
	h.pinnedMode = modeID
	h.mu.Unlock()
	runtime := h.runtimeBySession(sessionID)
	if runtime == nil || runtime.client == nil {
		// 会话还没起来：先记住，下次开会话时 applySessionModes 会补上。
		h.sendAgentModes()
		return nil
	}
	runtime.client.SetPinnedMode(modeID)
	if err := runtime.client.SetSessionMode(modeID); err != nil {
		log.Log("agent mode " + modeID + " skipped: " + err.Error())
	}
	h.refreshAgentModes(runtime)
	return nil
}

// adoptPinnedMode 把侧栏记住的选择交给所有 ACP 客户端：下次开会话时由
// applySessionModes 应用（发现不到就自动放弃，不会盲发）。
func (h *Host) adoptPinnedMode(modeID string) {
	h.mu.Lock()
	h.pinnedMode = modeID
	runtimes := append([]*acpRuntime{}, h.runtimes...)
	h.mu.Unlock()
	for _, runtime := range runtimes {
		if runtime.client != nil {
			runtime.client.SetPinnedMode(modeID)
		}
	}
}

// absorbSessionUpdate 处理 Agent 自己发的会话级变化：模型目录、模式集合，以及**Agent
// 自己换模式**（`current_mode_update`，典型是它从 plan 退出到 build）。最后这条以前全
// 仓库没人处理，UI 会一直停在旧值。
func (h *Host) absorbSessionUpdate(update map[string]any, runtime *acpRuntime) {
	switch str(update["sessionUpdate"]) {
	case "config_option_update":
		h.absorbConfigUpdate(update)
		h.refreshAgentModes(runtime)
	case "current_mode_update":
		h.refreshAgentModes(runtime)
	}
}

// resetAgentModes 换 Agent 时清空：模式集合是每家引擎自己的，不能串。
func (h *Host) resetAgentModes() {
	h.mu.Lock()
	h.agentModes = modes.Target{}
	h.hasAgentModes = false
	h.mu.Unlock()
}
