package workspace

import (
	"encoding/json"
	"os"
	"path/filepath"

	_ "embed"

	"github.com/parksben/cursor-sidebar/internal/paths"
	"github.com/parksben/cursor-sidebar/internal/protocol"
)

//go:embed agents.md
var agentsMD string

func Ensure() {
	_ = os.MkdirAll(paths.CommandsDir(), 0o755)
	_ = os.MkdirAll(paths.ResultsDir(), 0o755)
	_ = os.MkdirAll(paths.ScreenshotsDir(), 0o755)
	_ = os.MkdirAll(paths.PastedDir(), 0o755)
	_ = os.MkdirAll(paths.SidebarHome(), 0o755)
	_ = os.WriteFile(paths.AgentsMDPath(), []byte(agentsMD), 0o644)
	_ = os.WriteFile(paths.ClaudeMDPath(), []byte(agentsMD), 0o644)
	tools := map[string]any{
		"version":        6,
		"transport":      "workspace-files",
		"commandsDir":    "browser/commands",
		"resultsDir":     "browser/results",
		"screenshotsDir": "browser/screenshots",
		"methods":        protocol.ToolCatalog,
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

type pastedError string

func (e pastedError) Error() string { return string(e) }
