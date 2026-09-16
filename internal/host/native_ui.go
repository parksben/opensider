package host

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
)

// nativeUIEventLimit 是 browser/native-ui.json 里保留的事件条数：只给 Agent 看最近发生了什么。
// 全量历史看 host.log（那份按大小与日期轮转，所以不会无限涨，但也别依赖它回溯很久以前的事件）。
const nativeUIEventLimit = 50

type nativeUIDoc struct {
	UpdatedAt string           `json:"updatedAt"`
	Events    []map[string]any `json:"events"`
}

// handleNativeUi 把扩展报上来的原生 UI 事件落盘。
//
// 这些事件来自页面弹出的 alert / confirm / prompt / print / window.open 或文件选择器，
// 由扩展的主世界 shim 记录（见 TECH_DESIGN「原生 UI 感知与代答」）。同一批事件也会附在
// 触发它的那条命令结果里（`data.nativeUi`），所以 Agent 通常不必读这个文件；这里保留一份
// 是为了让它能看到「不在自己命令期间」发生的那些（用户自己点的、页面定时器弹的）。
func (h *Host) handleNativeUi(msg map[string]any) {
	raw, ok := msg["events"].([]any)
	if !ok || len(raw) == 0 {
		return
	}
	tabID := msg["tabId"]
	url := str(msg["url"])

	doc := nativeUIDoc{}
	if existing, err := os.ReadFile(paths.NativeUIPath()); err == nil {
		_ = json.Unmarshal(existing, &doc)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	for _, entry := range raw {
		event, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		item := make(map[string]any, len(event)+3)
		for key, value := range event {
			item[key] = value
		}
		if str(item["url"]) == "" {
			item["url"] = url
		}
		item["tabId"] = tabID
		item["recordedAt"] = now
		doc.Events = append(doc.Events, item)
	}
	if len(doc.Events) > nativeUIEventLimit {
		doc.Events = doc.Events[len(doc.Events)-nativeUIEventLimit:]
	}
	doc.UpdatedAt = now

	encoded, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return
	}
	_ = os.MkdirAll(paths.BrowserDir(), 0o755)
	if err := os.WriteFile(paths.NativeUIPath(), append(encoded, '\n'), 0o644); err != nil {
		log.Log("native-ui write: " + err.Error())
		return
	}
	kinds := make([]string, 0, len(raw))
	for _, entry := range raw {
		if event, ok := entry.(map[string]any); ok {
			kinds = append(kinds, str(event["kind"]))
		}
	}
	log.Log(fmt.Sprintf("native-ui kind=%v url=%s", kinds, url))
}
