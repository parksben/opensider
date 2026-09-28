package peer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEditorExtensionInstalledIn(t *testing.T) {
	root := t.TempDir()
	if editorExtensionInstalledIn([]string{root}) {
		t.Fatal("empty extensions dir should not count as installed")
	}
	if err := os.Mkdir(filepath.Join(root, "opensider.opensider-vscode-0.1.0"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !editorExtensionInstalledIn([]string{root, filepath.Join(root, "missing")}) {
		t.Fatal("expected the versioned extension folder to count as installed")
	}
	other := t.TempDir()
	if err := os.Mkdir(filepath.Join(other, "some.other-extension-1.0.0"), 0o755); err != nil {
		t.Fatal(err)
	}
	if editorExtensionInstalledIn([]string{other}) {
		t.Fatal("a different extension should not count")
	}
}
