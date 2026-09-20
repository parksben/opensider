// Package sessioncfg 解析 ACP 的会话配置项（`configOptions`）——mode / model 之外的
// 那部分也归它，例如推理档位（`thought_level`）和模型自身的开关（`model_config`）。
//
// 为什么单独一层：`configOptions` 是**同一份数据被三处消费**——模式发现（internal/modes）、
// 模型目录（internal/models）、以及推理档位这类新控件。以前前两处各写一套容错解析，
// 字段名、分组、包装层的兼容点只能各修各的。现在解析只在这里做一次，产出**带顺序的
// 强类型 Option**，上面两层都只消费结果。
//
// 容错到什么程度：这份数据各家的字段名和包装层都不完全一样（规范字段 `id`/`category`/
// `currentValue`/`options[].value`，但也有实现用 `configId`、把数组包在 `{configOptions:…}`
// 里、或把值写成裸字符串）。容错只针对**实测见过**的形态，不去猜没见过的形状。
//
// 本包是**纯逻辑**：不依赖进程、管道或网络，可以直接在真机 payload 上写表格单测。
package sessioncfg

import (
	"fmt"
	"strings"
)

// 规范里的类别（category）取值。类别只是 UX 元数据——规范要求客户端**缺省时也能优雅
// 降级**，各家不一定发、发了也不一定和这里同名，所以只认这两三类，其余只记日志。
const (
	CategoryMode         = "mode"
	CategoryModel        = "model"
	CategoryThoughtLevel = "thought_level"
	CategoryModelConfig  = "model_config"
	CategoryPermission   = "permissions"
)

// TypeSelect / TypeBoolean 是规范给的配置项类型（`type` 字段）。
const (
	TypeSelect  = "select"
	TypeBoolean = "boolean"
)

// Value 是配置项的一个可选值（`options[]` 里的一项，分组已摊平）。
type Value struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Desc string `json:"desc,omitempty"`
}

// Option 是一个解析好的会话配置项。字段一一对应 ACP，不做翻译、不做改写；
// 数组顺序也保持原样（规范说顺序即优先级，取同类第一项就是取最重要的那项）。
type Option struct {
	ID       string  `json:"id"`
	Category string  `json:"category,omitempty"`
	Name     string  `json:"name"`
	Type     string  `json:"type,omitempty"`
	Current  string  `json:"current,omitempty"`
	Values   []Value `json:"values,omitempty"`
}

// IsBoolean 报告这是不是一个布尔开关（规范里布尔项没有 `options` 列表）。
func (o Option) IsBoolean() bool {
	return strings.EqualFold(o.Type, TypeBoolean)
}

// HasValue 报告某个值是否真的在这个配置项广告过的集合里。发设置前必须过这一关：
// 盲发未广告的值是这套协议里最容易把会话弄坏的操作。
func (o Option) HasValue(id string) bool {
	for _, value := range o.Values {
		if value.ID == id {
			return true
		}
	}
	return false
}

// ValueName 返回某个值的显示名（找不到就退回 id 本身）。
func (o Option) ValueName(id string) string {
	for _, value := range o.Values {
		if value.ID == id {
			if value.Name != "" {
				return value.Name
			}
			return value.ID
		}
	}
	return id
}

// WireValue 把界面用的字符串值转成规范要求的 JSON 值，并给出要不要带 `type`。
// 规范要求**布尔值必须带 `type: "boolean"`**，否则引擎会当成字符串处理。
func (o Option) WireValue(value string) (any, string) {
	if o.IsBoolean() {
		return strings.EqualFold(value, "true"), TypeBoolean
	}
	return value, ""
}

// Parse 把 `session/new|load|fork` 或 `config_option_update` 里的原始 `configOptions`
// 解析成配置项列表。容忍实测见过的几种形态，顺序照原样保留。
func Parse(v any) []Option {
	switch raw := v.(type) {
	case []any:
		return parseList(raw)
	case []Option:
		return raw
	case map[string]any:
		// 有的实现把数组包在 `{configOptions: […]}` 里。
		if nested, ok := raw["configOptions"]; ok && nested != nil {
			return Parse(nested)
		}
		if option, ok := optionFromMap(raw); ok {
			return []Option{option}
		}
		// 最后一种兜底：本身不是配置项，但值里装着配置项。
		return parseList(mapValues(raw))
	default:
		return nil
	}
}

// ParseValues 解析一组「可选值」（`options[]` 的形状），legacy 的
// `modes.availableModes` 也是同一形状，两处共用一套摊平逻辑。
func ParseValues(v any) []Value {
	return parseValues(v)
}

// ByCategory 按类别取（规范字段 `category`，大小写不敏感），保持原顺序。
func ByCategory(options []Option, category string) []Option {
	var out []Option
	for _, option := range options {
		if strings.EqualFold(option.Category, category) {
			out = append(out, option)
		}
	}
	return out
}

// FirstOf 取某类别的第一项（规范说数组顺序即优先级）。
func FirstOf(options []Option, category string) (Option, bool) {
	for _, option := range options {
		if strings.EqualFold(option.Category, category) {
			return option, true
		}
	}
	return Option{}, false
}

// ByID 按 id / configId 取。
func ByID(options []Option, id string) (Option, bool) {
	if id == "" {
		return Option{}, false
	}
	for _, option := range options {
		if strings.EqualFold(option.ID, id) {
			return option, true
		}
	}
	return Option{}, false
}

// LookupMode 挑出表达 mode 的那个配置项：规范给的 `category` 优先，老实现不带
// category 才退回按 id 判断。
func LookupMode(options []Option) (Option, bool) {
	if option, ok := FirstOf(options, CategoryMode); ok {
		return option, true
	}
	return ByID(options, CategoryMode)
}

// LookupModel 挑出表达 model 的那个配置项（category 优先，其次 id 含 model）。
func LookupModel(options []Option) (Option, bool) {
	if option, ok := FirstOf(options, CategoryModel); ok {
		return option, true
	}
	for _, option := range options {
		if strings.Contains(strings.ToLower(option.ID), "model") {
			return option, true
		}
	}
	return Option{}, false
}

func parseList(items []any) []Option {
	var out []Option
	for _, item := range items {
		if option, ok := optionFromMap(item); ok {
			out = append(out, option)
		}
	}
	return out
}

func optionFromMap(v any) (Option, bool) {
	obj, ok := v.(map[string]any)
	if !ok {
		return Option{}, false
	}
	option := Option{
		ID:       firstStr(obj, "id", "configId"),
		Name:     str(obj["name"]),
		Category: str(obj["category"]),
		Type:     str(obj["type"]),
		Current:  currentString(obj),
		Values:   parseValues(obj["options"]),
	}
	if option.ID == "" && option.Category == "" && len(option.Values) == 0 {
		return Option{}, false
	}
	if option.Name == "" {
		option.Name = option.ID
	}
	return option, true
}

// parseValues 摊平 `options[]`：规范允许分组（`{group, name, options:[…]}`），分组只
// 影响排版。也容忍裸字符串写法（opencode 那类只给 id 的引擎）。
func parseValues(v any) []Value {
	var out []Value
	seen := map[string]bool{}
	add := func(value Value) {
		if value.ID == "" || seen[value.ID] {
			return
		}
		if value.Name == "" {
			value.Name = value.ID
		}
		seen[value.ID] = true
		out = append(out, value)
	}
	for _, item := range asSlice(v) {
		switch entry := item.(type) {
		case string:
			add(Value{ID: strings.TrimSpace(entry)})
		case map[string]any:
			// 分组：自己没有 value/id，但带着 options。
			if nested, ok := entry["options"]; ok && entry["value"] == nil && entry["id"] == nil && entry["modelId"] == nil {
				for _, value := range parseValues(nested) {
					add(value)
				}
				continue
			}
			add(Value{
				ID:   firstStr(entry, "value", "id", "modelId"),
				Name: str(entry["name"]),
				Desc: str(entry["description"]),
			})
		}
	}
	return out
}

func currentString(obj map[string]any) string {
	if raw, ok := obj["currentValue"]; ok && raw != nil {
		if text := valueString(raw); text != "" {
			return text
		}
	}
	return valueString(obj["value"])
}

func valueString(v any) string {
	switch value := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(value)
	case bool:
		return fmt.Sprintf("%t", value)
	case float64:
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	default:
		return ""
	}
}

func mapValues(obj map[string]any) []any {
	out := make([]any, 0, len(obj))
	for _, item := range obj {
		out = append(out, item)
	}
	return out
}

func asSlice(v any) []any {
	if items, ok := v.([]any); ok {
		return items
	}
	return nil
}

func firstStr(obj map[string]any, keys ...string) string {
	for _, key := range keys {
		if text := str(obj[key]); text != "" {
			return text
		}
	}
	return ""
}

func str(v any) string {
	text, _ := v.(string)
	return strings.TrimSpace(text)
}
