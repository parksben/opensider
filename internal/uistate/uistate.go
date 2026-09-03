package uistate

import (
	"encoding/json"
	"os"

	"github.com/parksben/opensider/internal/paths"
)

type File struct {
	Version  int              `json:"version"`
	SavedAt  string           `json:"savedAt,omitempty"`
	Sessions []map[string]any `json:"sessions"`
}

func LoadRaw() (json.RawMessage, bool) {
	raw, err := os.ReadFile(paths.UIStatePath())
	if err != nil || len(raw) == 0 {
		return nil, false
	}
	if !json.Valid(raw) {
		return nil, false
	}
	return raw, true
}

func LoadMap() (map[string]any, bool) {
	raw, ok := LoadRaw()
	if !ok {
		return nil, false
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, false
	}
	return out, true
}

func HasHistory(state map[string]any) bool {
	if state == nil {
		return false
	}
	raw, ok := state["sessions"].([]any)
	if !ok {
		return false
	}
	for _, item := range raw {
		session, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if str(session["acpSessionId"]) != "" {
			return true
		}
		if providers, ok := session["acpByProvider"].(map[string]any); ok && len(providers) > 0 {
			return true
		}
		if messages, ok := session["messages"].([]any); ok && len(messages) > 0 {
			return true
		}
	}
	return false
}

func Save(state map[string]any) error {
	if state == nil {
		return nil
	}
	if !HasHistory(state) {
		if existing, ok := LoadMap(); ok && HasHistory(existing) {
			return nil
		}
	}
	_ = os.MkdirAll(paths.SidebarHome(), 0o755)
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(paths.UIStatePath(), append(raw, '\n'), 0o644)
}

func str(v any) string {
	s, _ := v.(string)
	return s
}
