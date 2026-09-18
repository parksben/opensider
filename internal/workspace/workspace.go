package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	_ "embed"

	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/protocol"
)

//go:embed agents.md
var agentsMD string

func Ensure() {
	_ = os.MkdirAll(paths.CommandsDir(), 0o755)
	_ = os.MkdirAll(paths.ResultsDir(), 0o755)
	_ = os.MkdirAll(paths.ScreenshotsDir(), 0o755)
	_ = os.MkdirAll(paths.PastedDir(), 0o755)
	_ = os.MkdirAll(paths.OutputsDir(), 0o755)
	_ = os.MkdirAll(paths.SidebarHome(), 0o755)
	_ = os.WriteFile(paths.AgentsMDPath(), []byte(agentsMD), 0o644)
	_ = os.WriteFile(paths.ClaudeMDPath(), []byte(agentsMD), 0o644)
	tools := map[string]any{
		"version":        12,
		"transport":      "workspace-files",
		"commandsDir":    "browser/commands",
		"resultsDir":     "browser/results",
		"screenshotsDir": "browser/screenshots",
		"outputsDir":     "outputs",
		// While the side panel is open the tab the Agent works with is forced to look
		// visible and focused to the page (see agents.md). Static description: the live
		// state is per tab and per moment.
		"pageActivity": map[string]any{
			"forcedWhilePanelOpen": true,
			"stealsWindowFocus":    false,
			"note":                 "The tab you operate reads document.visibilityState === \"visible\" and hasFocus() === true, and does not receive visibilitychange/blur/pagehide/freeze, while the side panel is open.",
		},
		// Quiet defaults + tab control (see agents.md «Tab control»): static description only.
		"tabControl": map[string]any{
			"quietByDefault": true,
			"note": "openTab opens in the background next to your working tab and becomes yours; no command changes the user's active tab or window focus, except switchTab (show) and screenshots (a brief flip that is restored).",
		},
		"methods": protocol.ToolCatalog,
	}
	raw, _ := json.MarshalIndent(tools, "", "  ")
	_ = os.WriteFile(paths.ToolsPath(), append(raw, '\n'), 0o644)
}

func WriteCurrentPage(page protocol.CurrentPage) {
	_ = os.MkdirAll(paths.BrowserDir(), 0o755)
	compact := map[string]any{
		"tabId":     page.TabID,
		"url":       page.URL,
		"title":     page.Title,
		"updatedAt": page.UpdatedAt,
	}
	if page.Target != nil {
		compact["target"] = page.Target
	}
	raw, _ := json.MarshalIndent(compact, "", "  ")
	_ = os.WriteFile(paths.CurrentPagePath(), append(raw, '\n'), 0o644)
	interactive := page.Interactive
	if trimSpace(interactive) == "" {
		interactive = "_No interactive controls indexed._"
	}
	readable := page.Readable
	if trimSpace(readable) == "" {
		readable = "_No readable extract available._"
	}
	_ = os.WriteFile(paths.InteractivePath(), []byte("# "+page.Title+"\n\n"+page.URL+"\n\n"+interactive+"\n"), 0o644)
	snapshot := "# " + page.Title + "\n\n" + page.URL + "\n\n## Interactive controls\n\nSee `browser/interactive.md`. Use `args.index` (1-based) or `fillForm`.\n\n" + interactive + "\n\n## Readable text\n\n" + readable + "\n"
	_ = os.WriteFile(paths.SnapshotPath(), []byte(snapshot), 0o644)
}

func WriteTabsSnapshot(snapshot protocol.TabsSnapshot) {
	_ = os.MkdirAll(paths.BrowserDir(), 0o755)
	raw, _ := json.MarshalIndent(snapshot, "", "  ")
	_ = os.WriteFile(paths.TabsPath(), append(raw, '\n'), 0o644)
}

func WriteSessionID(sessionID string) {
	_ = os.MkdirAll(paths.SidebarHome(), 0o755)
	raw, _ := json.MarshalIndent(map[string]string{"sessionId": sessionID}, "", "  ")
	_ = os.WriteFile(paths.SessionPath(), append(raw, '\n'), 0o644)
}

func SavePastedJPEG(imageBase64 string, suggestedName string) (protocol.AttachmentItem, error) {
	const maxBase64 = 800_000
	if imageBase64 == "" || len(imageBase64) > maxBase64 {
		return protocol.AttachmentItem{}, errPastedTooLarge
	}
	_ = os.MkdirAll(paths.PastedDir(), 0o755)
	stamp := isoStamp()
	raw := filepath.Base(suggestedName)
	if raw == "" || raw == "." {
		raw = "paste-" + stamp + ".jpg"
	}
	safe := sanitizeName(raw)
	if safe == "" {
		safe = "paste-" + stamp + ".jpg"
	}
	name := safe
	if !hasJPEGExt(name) {
		name += ".jpg"
	}
	p := filepath.Join(paths.PastedDir(), name)
	if _, err := os.Stat(p); err == nil {
		p = filepath.Join(paths.PastedDir(), "paste-"+stamp+".jpg")
	}
	data, err := decodeBase64(imageBase64)
	if err != nil {
		return protocol.AttachmentItem{}, err
	}
	if err := os.WriteFile(p, data, 0o644); err != nil {
		return protocol.AttachmentItem{}, err
	}
	return protocol.AttachmentItem{Path: p, Name: filepath.Base(p), Kind: protocol.KindImage}, nil
}

var errPastedTooLarge = pastedError("pasted image is empty or too large")

// SaveUploaded 把用户拖进侧栏的一个文件写到 `browser/uploads/` 下，并回它对应的附件项。
//
// Chrome 不给拖入文件的本机路径（DataTransfer 里只有 File 对象），所以侧栏把字节送过来、
// 这里落盘，之后一切都按普通路径附件走（Agent 读的是工作区里的这份副本）。
//
//   - 单个文件：`name` 是文件名，`dir` 为空；
//   - 文件夹里的文件：`dir` 是拖进来的文件夹名，`name` 是该文件夹内的相对路径，
//     例如 `dir=proj` + `name=src/a.ts` 写成 `uploads/proj/src/a.ts`。
//
// `dir` / `name` 逐段 sanitize，拒绝空段、`.`、`..` 与绝对路径；同名文件加时间戳后缀，
// 不覆盖之前的。
func SaveUploaded(name, dir, encoded string) ([]protocol.AttachmentItem, error) {
	const maxBase64 = 800_000
	if encoded == "" || len(encoded) > maxBase64 {
		return nil, errUploadTooLarge
	}
	rel, err := uploadRelPath(name, dir)
	if err != nil {
		return nil, err
	}
	root := paths.UploadsDir()
	target := filepath.Join(root, rel)
	// 双重保险：拼出来的路径必须真的落在 uploads/ 里。
	if !strings.HasPrefix(target, root+string(os.PathSeparator)) {
		return nil, errUploadPath
	}
	created := false
	if dir != "" {
		folder := filepath.Join(root, sanitizeSegment(dir))
		if _, statErr := os.Stat(folder); statErr != nil {
			created = true
		}
	}
	if mkErr := os.MkdirAll(filepath.Dir(target), 0o755); mkErr != nil {
		return nil, mkErr
	}
	if _, statErr := os.Stat(target); statErr == nil {
		ext := filepath.Ext(target)
		stem := strings.TrimSuffix(target, ext)
		target = stem + "-" + isoStamp() + ext
	}
	data, err := decodeBase64(encoded)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return nil, err
	}
	items := make([]protocol.AttachmentItem, 0, 2)
	// 文件夹只在这次真的建出来时带一条：侧栏按 path 去重，多报也无害，但少报会让
	// 用户看不到那个文件夹附件。
	if dir != "" && created {
		folder := filepath.Join(root, sanitizeSegment(dir))
		items = append(items, protocol.AttachmentItem{
			Path: folder,
			Name: filepath.Base(folder),
			Kind: protocol.KindFolder,
		})
	}
	items = append(items, protocol.AttachmentItem{
		Path: target,
		Name: filepath.Base(target),
		Kind: protocol.KindFile,
	})
	return items, nil
}

// uploadRelPath 把 (name, dir) 变成 uploads/ 下的相对路径；任何可疑段都直接报错。
func uploadRelPath(name, dir string) (string, error) {
	segments := []string{}
	if dir != "" {
		// 文件夹名只是拖进来那一层的名字，出现路径语法说明输入不可能是我们发出去的。
		if dir == "." || dir == ".." || strings.ContainsAny(dir, `/\`) || filepath.IsAbs(dir) {
			return "", errUploadPath
		}
		segments = append(segments, sanitizeSegment(dir))
	}
	for _, part := range strings.Split(strings.ReplaceAll(name, "\\", "/"), "/") {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return "", errUploadPath
		}
		segments = append(segments, sanitizeSegment(part))
	}
	if len(segments) == 0 || filepath.IsAbs(name) {
		return "", errUploadPath
	}
	return filepath.Join(segments...), nil
}

func sanitizeSegment(part string) string {
	safe := sanitizeName(part)
	if safe == "" || safe == "." || safe == ".." {
		return "upload-" + isoStamp()
	}
	return safe
}

var (
	errUploadTooLarge = pastedError("dropped file is empty or too large")
	errUploadPath     = pastedError("dropped file has an unusable name")
)

type pastedError string

func (e pastedError) Error() string { return string(e) }
