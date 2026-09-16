package host

import (
	"encoding/json"
	"os"
	"time"

	"github.com/parksben/opensider/internal/paths"
)

// overlaysDoc 是 browser/overlays.json 的形状：页面当前盖在最上面的那些层。
//
// 与 native-ui.json 的区别：那是浏览器原生弹窗（alert / confirm / 文件选择器…），
// 这是**页面自己**画的模态框 / 抽屉 / 遮罩。两者互为补充，Agent 看局面时都要看。
type overlaysDoc struct {
	UpdatedAt string           `json:"updatedAt"`
	TabID     any              `json:"tabId,omitempty"`
	URL       string           `json:"url,omitempty"`
	Modal     bool             `json:"modal"`
	Overlays  []map[string]any `json:"overlays"`
}

// handleOverlays 把扩展报上来的浮层快照**整表覆盖**写盘。
//
// 覆盖而不是追加：这是「现在盖在上面的是什么」，不是事件流；没有浮层时写空表，免得留下
// 上一次的旧值让 Agent 以为框还开着。同一份快照也会附在触发它的那条命令结果里
// （`data.overlays`），只有出现或变化时才带。
func (h *Host) handleOverlays(msg map[string]any) error {
	doc := overlaysDoc{
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		TabID:     msg["tabId"],
		URL:       str(msg["url"]),
		Modal:     msg["modal"] == true,
		Overlays:  []map[string]any{},
	}
	if raw, ok := msg["overlays"].([]any); ok {
		for _, entry := range raw {
			item, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			doc.Overlays = append(doc.Overlays, item)
		}
	}
	if err := os.MkdirAll(paths.BrowserDir(), 0o755); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(paths.OverlaysPath(), append(payload, '\n'), 0o644)
}
