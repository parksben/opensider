package models

import (
	"context"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/protocol"
)

type ConfigOption struct {
	ID           string         `json:"id"`
	ConfigID     string         `json:"configId"`
	Name         string         `json:"name"`
	Category     string         `json:"category"`
	Type         string         `json:"type"`
	CurrentValue any            `json:"currentValue"`
	Options      []ConfigChoice `json:"options"`
}

type ConfigChoice struct {
	Value string `json:"value"`
	Name  string `json:"name"`
}

type Catalog struct {
	Models        []protocol.AgentModel
	CurrentID     string
	ModelConfigID string
}

var modelLine = regexp.MustCompile(`^(\S+)\s+-\s+(.+)$`)

func IsUnsetModel(id string) bool {
	return id == "" || id == "auto"
}

func UniqueModels(models []protocol.AgentModel) []protocol.AgentModel {
	byID := map[string]protocol.AgentModel{}
	var order []string
	for _, model := range models {
		if model.ID == "" {
			continue
		}
		if _, ok := byID[model.ID]; !ok {
			order = append(order, model.ID)
		}
		byID[model.ID] = model
	}
	out := make([]protocol.AgentModel, 0, len(order))
	for _, id := range order {
		out = append(out, byID[id])
	}
	return out
}

func ParseAgentModels(stdout string) Catalog {
	var models []protocol.AgentModel
	var markedCurrent, markedDefault string
	for _, raw := range strings.Split(stdout, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		m := modelLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		id := m[1]
		rawName := m[2]
		if regexp.MustCompile(`(?i)\(current\)`).MatchString(rawName) {
			markedCurrent = id
		} else if regexp.MustCompile(`(?i)\(default\)`).MatchString(rawName) {
			markedDefault = id
		}
		name := regexp.MustCompile(`(?i)\s*\((?:default|current)\)`).ReplaceAllString(rawName, "")
		name = strings.TrimSpace(name)
		if name == "" {
			name = id
		}
		models = append(models, protocol.AgentModel{ID: id, Name: name})
	}
	unique := UniqueModels(models)
	currentID := ""
	for _, model := range unique {
		if model.ID == "auto" {
			currentID = model.ID
			break
		}
	}
	if currentID == "" && markedCurrent != "" && hasModel(unique, markedCurrent) {
		currentID = markedCurrent
	}
	if currentID == "" && markedDefault != "" && hasModel(unique, markedDefault) {
		currentID = markedDefault
	}
	if currentID == "" && len(unique) > 0 {
		currentID = unique[0].ID
	}
	return Catalog{Models: unique, CurrentID: currentID, ModelConfigID: "model"}
}

func CatalogFromConfigOptions(options []ConfigOption) Catalog {
	var model *ConfigOption
	for i := range options {
		option := &options[i]
		id := strings.ToLower(option.ID + " " + option.ConfigID)
		if option.Category == "model" || strings.Contains(id, "model") {
			model = option
			break
		}
	}
	if model == nil {
		return Catalog{}
	}
	var models []protocol.AgentModel
	for _, option := range model.Options {
		if option.Value == "" {
			continue
		}
		name := option.Name
		if name == "" {
			name = option.Value
		}
		models = append(models, protocol.AgentModel{ID: option.Value, Name: name})
	}
	unique := UniqueModels(models)
	currentID := ""
	if s, ok := model.CurrentValue.(string); ok {
		currentID = s
	}
	configID := model.ID
	if configID == "" {
		configID = model.ConfigID
	}
	if configID == "" {
		configID = "model"
	}
	out := Catalog{CurrentID: currentID, ModelConfigID: configID}
	if len(unique) > 0 {
		out.Models = unique
	}
	return out
}

func CatalogFromSessionModels(models any) Catalog {
	rec, ok := models.(map[string]any)
	if !ok || rec == nil {
		return Catalog{}
	}
	var mapped []protocol.AgentModel
	if raw, ok := rec["availableModels"].([]any); ok {
		for _, item := range raw {
			obj, ok := item.(map[string]any)
			if !ok {
				continue
			}
			id := str(obj["modelId"])
			if id == "" {
				id = str(obj["id"])
			}
			if id == "" {
				continue
			}
			name := str(obj["name"])
			if name == "" {
				name = id
			}
			mapped = append(mapped, protocol.AgentModel{ID: id, Name: name})
		}
	}
	unique := UniqueModels(mapped)
	out := Catalog{CurrentID: str(rec["currentModelId"])}
	if len(unique) > 0 {
		out.Models = unique
	}
	return out
}

func CopilotFallbackCatalog() Catalog {
	return Catalog{
		Models: []protocol.AgentModel{
			{ID: "auto", Name: "Auto"},
			{ID: "claude-sonnet-4.6", Name: "Claude Sonnet 4.6"},
			{ID: "claude-sonnet-4.5", Name: "Claude Sonnet 4.5"},
			{ID: "claude-haiku-4.5", Name: "Claude Haiku 4.5"},
			{ID: "claude-opus-4.8", Name: "Claude Opus 4.8"},
			{ID: "claude-opus-4.7", Name: "Claude Opus 4.7"},
			{ID: "claude-opus-4.6", Name: "Claude Opus 4.6"},
			{ID: "claude-opus-4.6-fast", Name: "Claude Opus 4.6 Fast"},
			{ID: "claude-opus-4.5", Name: "Claude Opus 4.5"},
			{ID: "gpt-5.5", Name: "GPT-5.5"},
			{ID: "gpt-5.4", Name: "GPT-5.4"},
			{ID: "gpt-5.3-codex", Name: "GPT-5.3 Codex"},
			{ID: "gpt-5.2-codex", Name: "GPT-5.2 Codex"},
			{ID: "gpt-5.2", Name: "GPT-5.2"},
			{ID: "gpt-5.4-mini", Name: "GPT-5.4 Mini"},
			{ID: "gpt-5-mini", Name: "GPT-5 Mini"},
		},
		CurrentID:     "auto",
		ModelConfigID: "model",
	}
}

func MergeCatalog(base Catalog, overlay Catalog) Catalog {
	byID := map[string]protocol.AgentModel{}
	var order []string
	add := func(model protocol.AgentModel) {
		if model.ID == "" {
			return
		}
		if _, ok := byID[model.ID]; !ok {
			order = append(order, model.ID)
		}
		byID[model.ID] = model
	}
	for _, model := range base.Models {
		add(model)
	}
	for _, model := range overlay.Models {
		add(model)
	}
	models := make([]protocol.AgentModel, 0, len(order))
	for _, id := range order {
		models = append(models, byID[id])
	}
	currentID := ""
	if overlay.CurrentID != "" && hasModel(models, overlay.CurrentID) {
		currentID = overlay.CurrentID
	} else if hasModel(models, base.CurrentID) {
		currentID = base.CurrentID
	} else if len(models) > 0 {
		currentID = models[0].ID
	}
	configID := overlay.ModelConfigID
	if configID == "" {
		configID = base.ModelConfigID
	}
	return Catalog{Models: UniqueModels(models), CurrentID: currentID, ModelConfigID: configID}
}

func ListAgentModels(agentPath string) Catalog {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, agentPath, "models")
	out, err := cmd.Output()
	if err != nil {
		log.Log("list models failed: " + err.Error())
		return Catalog{ModelConfigID: "model"}
	}
	return ParseAgentModels(string(out))
}

func OptionsFromAny(v any) []ConfigOption {
	raw, ok := v.([]any)
	if !ok {
		return nil
	}
	var out []ConfigOption
	for _, item := range raw {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		opt := ConfigOption{
			ID:           str(obj["id"]),
			ConfigID:     str(obj["configId"]),
			Name:         str(obj["name"]),
			Category:     str(obj["category"]),
			Type:         str(obj["type"]),
			CurrentValue: obj["currentValue"],
		}
		if choices, ok := obj["options"].([]any); ok {
			for _, c := range choices {
				co, ok := c.(map[string]any)
				if !ok {
					continue
				}
				opt.Options = append(opt.Options, ConfigChoice{Value: str(co["value"]), Name: str(co["name"])})
			}
		}
		out = append(out, opt)
	}
	return out
}

func hasModel(models []protocol.AgentModel, id string) bool {
	for _, model := range models {
		if model.ID == id {
			return true
		}
	}
	return false
}

func str(v any) string {
	s, _ := v.(string)
	return s
}
