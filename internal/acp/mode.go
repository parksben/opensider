package acp

import (
	"strings"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/protocol"
)

func advertisedModeIDs(configOptions any, modes any) []string {
	seen := map[string]bool{}
	var out []string
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		out = append(out, id)
	}
	for _, item := range asSlice(modes) {
		switch m := item.(type) {
		case string:
			add(m)
		case map[string]any:
			add(str(m["id"]))
			add(str(m["modeId"]))
			add(str(m["value"]))
		}
	}
	for _, item := range asSlice(configOptions) {
		opt, ok := item.(map[string]any)
		if !ok || !isModeConfig(opt) {
			continue
		}
		add(str(opt["currentValue"]))
		for _, raw := range asSlice(opt["options"]) {
			choice, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			add(str(choice["value"]))
			add(str(choice["id"]))
		}
	}
	return out
}

func modeConfigID(configOptions any) string {
	for _, item := range asSlice(configOptions) {
		opt, ok := item.(map[string]any)
		if !ok || !isModeConfig(opt) {
			continue
		}
		if id := str(opt["id"]); id != "" {
			return id
		}
		if id := str(opt["configId"]); id != "" {
			return id
		}
		return "mode"
	}
	return ""
}

func isModeConfig(opt map[string]any) bool {
	id := strings.ToLower(str(opt["id"]))
	cat := strings.ToLower(str(opt["category"]))
	return id == "mode" || cat == "mode"
}

func pickModeCandidates(wanted, advertised []string) []string {
	if len(advertised) == 0 {
		return wanted
	}
	allow := map[string]bool{}
	for _, id := range advertised {
		allow[id] = true
	}
	var out []string
	seen := map[string]bool{}
	for _, id := range wanted {
		if allow[id] && !seen[id] {
			out = append(out, id)
			seen[id] = true
		}
	}
	return out
}

func (c *Client) rememberSessionModes(obj map[string]any) {
	c.mu.Lock()
	c.configOptions = obj["configOptions"]
	c.sessionModes = obj["modes"]
	if c.sessionModes == nil {
		c.sessionModes = obj["availableModes"]
	}
	c.mu.Unlock()
}

func (c *Client) trySetPolicyMode(sessionID string) {
	c.mu.Lock()
	wanted := append([]string(nil), c.launch.Profile.ModeMap[c.policy]...)
	advertised := advertisedModeIDs(c.configOptions, c.sessionModes)
	configID := modeConfigID(c.configOptions)
	c.mu.Unlock()
	candidates := pickModeCandidates(wanted, advertised)
	if len(candidates) == 0 {
		if c.policy != protocol.PolicyAsk && len(advertised) > 0 {
			log.Log("session mode skipped: none of " + strings.Join(wanted, ",") + " advertised")
		}
		return
	}
	for _, modeID := range candidates {
		if _, err := c.request("session/set_mode", map[string]any{"sessionId": sessionID, "modeId": modeID}); err != nil {
			log.Log("session/set_mode " + modeID + " skipped: " + err.Error())
			continue
		}
		return
	}
	if configID == "" {
		return
	}
	for _, modeID := range candidates {
		if _, err := c.request("session/set_config_option", map[string]any{
			"sessionId": sessionID,
			"configId":  configID,
			"value":     modeID,
		}); err != nil {
			log.Log("session/set_config_option mode " + modeID + " skipped: " + err.Error())
			continue
		}
		return
	}
}

func asSlice(v any) []any {
	switch items := v.(type) {
	case []any:
		return items
	default:
		return nil
	}
}
