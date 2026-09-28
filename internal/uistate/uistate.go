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
	state, _, err := loadSplit(paths.UIStatePath())
	if err != nil {
		// Splitting failed before the original was touched. Keep serving the
		// inline file so the panel still has its history.
		return readMap(paths.UIStatePath())
	}
	if state == nil {
		return nil, false
	}
	return state, true
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
	path := paths.UIStatePath()
	existing, hashes, err := loadSplit(path)
	if err != nil {
		return err
	}
	// An empty first frame after a reinstall must not wipe the mirror.
	if !HasHistory(state) && HasHistory(existing) {
		return nil
	}
	return writeSplit(path, state, hashes)
}

func str(v any) string {
	s, _ := v.(string)
	return s
}
