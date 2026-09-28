package peer

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/parksben/opensider/internal/paths"
)

const editorExtensionPrefix = "opensider.opensider-vscode-"

// EditorExtensionInstalled reports whether OpenSider for VS Code is installed
// for VS Code, Cursor, or another editor that uses the same extensions folder.
func EditorExtensionInstalled() bool {
	return editorExtensionInstalledIn(editorExtensionRoots())
}

func editorExtensionInstalledIn(roots []string) bool {
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), editorExtensionPrefix) {
				return true
			}
		}
	}
	return false
}

func editorExtensionRoots() []string {
	home := paths.Home()
	if home == "" {
		return nil
	}
	return []string{
		filepath.Join(home, ".vscode", "extensions"),
		filepath.Join(home, ".vscode-insiders", "extensions"),
		filepath.Join(home, ".vscode-oss", "extensions"),
		filepath.Join(home, ".cursor", "extensions"),
		filepath.Join(home, ".cursor-nightly", "extensions"),
		filepath.Join(home, ".windsurf", "extensions"),
	}
}
