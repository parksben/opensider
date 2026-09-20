package acp

import (
	"fmt"
	"strings"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/modes"
)

// rememberSessionOptions 记住这次会话广告出来的原始字段（configOptions / modes）。
// 这里只搬运，解析全在 internal/modes——各家的怪癖不该渗进 ACP 传输层。
func (c *Client) rememberSessionOptions(obj map[string]any) {
	c.mu.Lock()
	c.configOptions = obj["configOptions"]
	c.sessionModes = obj["modes"]
	if c.sessionModes == nil {
		c.sessionModes = obj["availableModes"]
	}
	c.modeCurrent = ""
	c.mu.Unlock()
}

// SessionModes 返回当前会话可切换的模式（泛化发现）。第二个返回值为 false 表示这家
// 没有可切换的模式，侧栏就不该画这个控件。
func (c *Client) SessionModes() (modes.Target, bool) {
	c.mu.Lock()
	configOptions := c.configOptions
	legacy := c.sessionModes
	current := c.modeCurrent
	agentID := c.launch.Profile.ID
	c.mu.Unlock()
	target, ok := modes.Discover(agentID, configOptions, legacy)
	if !ok {
		return target, false
	}
	if current != "" && target.Has(current) {
		target.Current = current
	}
	return target, true
}

// SetPinnedMode 告诉客户端用户显式选了哪个模式（空串表示没选）。选过之后权限档不再
// 覆盖模式选择——见 modes.Plan。
func (c *Client) SetPinnedMode(modeID string) {
	c.mu.Lock()
	c.pinnedMode = modeID
	c.mu.Unlock()
}

// SetSessionMode 把会话切到指定模式：有 mode 配置项走 set_config_option，否则 set_mode
// （规范里 Config Options 已经取代 Session Modes，前者不会消失）。只接受广告过的 id。
func (c *Client) SetSessionMode(id string) error {
	target, ok := c.SessionModes()
	if !ok {
		return fmt.Errorf("no switchable session mode advertised")
	}
	if !target.Has(id) {
		return fmt.Errorf("session mode %q not advertised", id)
	}
	sessionID := c.GetSessionID()
	if sessionID == "" {
		return fmt.Errorf("no session")
	}
	if target.Source == modes.SourceConfig {
		result, err := c.request("session/set_config_option", map[string]any{
			"sessionId": sessionID,
			"configId":  target.ConfigID,
			"value":     id,
		})
		if err != nil {
			return err
		}
		c.recordMode(id, result)
		return nil
	}
	result, err := c.request("session/set_mode", map[string]any{
		"sessionId": sessionID,
		"modeId":    id,
	})
	if err != nil {
		return err
	}
	c.recordMode(id, result)
	return nil
}

// recordMode 把刚设成功的模式记成当前值，否则会话广告里的 currentValue 会一直停在旧值，
// 推给侧栏的快照就成了「点了没反应」。
//
// 规范说 `session/set_config_option` 的返回里带**完整**的 configOptions，那就优先用它
// （它连带把其它项的联动变化也带回来了，例如换模型后可用思考档位变了）；没带才退回到
// 只记当前模式。
func (c *Client) recordMode(id string, result any) {
	if obj, ok := result.(map[string]any); ok {
		if configOptions := obj["configOptions"]; configOptions != nil {
			c.mu.Lock()
			c.configOptions = configOptions
			c.modeCurrent = ""
			c.mu.Unlock()
			return
		}
	}
	c.mu.Lock()
	c.modeCurrent = id
	c.mu.Unlock()
}

// applySessionModes 是会话刚起来、或权限档变了之后把「该是什么模式」落下去：用户显式
// 选过的模式优先（且必须仍被广告），其次才让权限档表达成 CLI 侧设置。不推工作流模式
// ——旧实现把 policy=ask 映射成 OpenCode 的 plan，用户只是想要「每次都问」就被静默切进
// 计划模式，那是这个功能要修的病根。
func (c *Client) applySessionModes() {
	if c.GetSessionID() == "" {
		return
	}
	c.mu.Lock()
	pinned := c.pinnedMode
	policy := c.policy
	agentID := c.launch.Profile.ID
	configOptions := c.configOptions
	c.mu.Unlock()

	target, has := c.SessionModes()
	if pinned != "" && has && target.Has(pinned) {
		if pinned != target.Current {
			if err := c.SetSessionMode(pinned); err != nil {
				log.Log("session mode " + pinned + " not applied: " + err.Error())
			}
		}
		return
	}
	push := modes.Plan(policy, agentID, target, has, configOptions, pinned)
	if push.ModeID != "" && push.ModeID != target.Current {
		if err := c.SetSessionMode(push.ModeID); err != nil {
			log.Log("session mode " + push.ModeID + " skipped: " + err.Error())
		}
	}
	if push.ConfigID != "" {
		c.setConfigValue(push.ConfigID, push.ConfigValue)
	}
}

func (c *Client) setConfigValue(configID, value string) {
	sessionID := c.GetSessionID()
	if sessionID == "" || configID == "" || value == "" {
		return
	}
	if _, err := c.request("session/set_config_option", map[string]any{
		"sessionId": sessionID,
		"configId":  configID,
		"value":     value,
	}); err != nil {
		log.Log("session/set_config_option " + configID + "=" + value + " skipped: " + err.Error())
	}
}

// noteModeUpdate 把「Agent 自己换模式 / 自己改配置」记下来，好让 SessionModes() 与侧栏
// 都跟上。`current_mode_update` 以前全仓库没人处理，Agent 从 plan 退出后 UI 会停在旧值。
func (c *Client) noteModeUpdate(update map[string]any) bool {
	switch strings.TrimSpace(str(update["sessionUpdate"])) {
	case "current_mode_update":
		id := str(update["currentModeId"])
		if id == "" {
			return false
		}
		c.mu.Lock()
		c.modeCurrent = id
		c.mu.Unlock()
		return true
	case "config_option_update":
		configOptions := update["configOptions"]
		if configOptions == nil {
			return false
		}
		c.mu.Lock()
		c.configOptions = configOptions
		// 配置项带着权威的 currentValue，清掉覆盖值让发现重新读。
		c.modeCurrent = ""
		c.mu.Unlock()
		return true
	default:
		return false
	}
}
