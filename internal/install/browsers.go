package install

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/protocol"
)

func Register(hostPath string) ([]string, error) {
	manifest := map[string]any{
		"name":            protocol.HostName,
		"description":     "OpenSider native host",
		"path":            hostPath,
		"type":            "stdio",
		"allowed_origins": []string{
			"chrome-extension://" + protocol.ExtensionID + "/",
			"chrome-extension://" + protocol.PackedExtensionID + "/",
		},
	}
	raw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	raw = append(raw, '\n')

	runtimeManifest := filepath.Join(paths.RuntimeDir(), protocol.HostName+".json")
	if err := os.WriteFile(runtimeManifest, raw, 0o644); err != nil {
		return nil, err
	}

	var written []string
	seen := map[string]bool{}
	for _, dir := range collectManifestDirs() {
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		dest := filepath.Join(dir, protocol.HostName+".json")
		if err := os.WriteFile(dest, raw, 0o644); err != nil {
			continue
		}
		_ = os.Remove(filepath.Join(dir, previousHost+".json"))
		written = append(written, dest)
	}
	if err := writeRegistry(runtimeManifest); err != nil {
		return written, err
	}
	if len(written) == 0 {
		written = append(written, runtimeManifest)
	}
	return written, nil
}

func collectManifestDirs() []string {
	var dirs []string
	seen := map[string]bool{}
	add := func(dir string) {
		if dir == "" || seen[dir] {
			return
		}
		seen[dir] = true
		dirs = append(dirs, dir)
	}
	for _, root := range browserRoots() {
		add(filepath.Join(root, "NativeMessagingHosts"))
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			name := entry.Name()
			if name != "Default" && !strings.HasPrefix(name, "Profile ") {
				continue
			}
			add(filepath.Join(root, name, "NativeMessagingHosts"))
		}
	}
	return dirs
}

func browserRoots() []string {
	home := paths.Home()
	switch runtime.GOOS {
	case "darwin":
		app := filepath.Join(home, "Library", "Application Support")
		return []string{
			filepath.Join(app, "Google", "Chrome"),
			filepath.Join(app, "Google", "Chrome Beta"),
			filepath.Join(app, "Google", "Chrome Canary"),
			filepath.Join(app, "Google", "Chrome Dev"),
			filepath.Join(app, "Chromium"),
			filepath.Join(app, "Microsoft Edge"),
			filepath.Join(app, "Microsoft Edge Beta"),
			filepath.Join(app, "Microsoft Edge Dev"),
			filepath.Join(app, "Microsoft Edge Canary"),
			filepath.Join(app, "BraveSoftware", "Brave-Browser"),
			filepath.Join(app, "BraveSoftware", "Brave-Browser-Beta"),
			filepath.Join(app, "BraveSoftware", "Brave-Browser-Nightly"),
		}
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			local = filepath.Join(home, "AppData", "Local")
		}
		return []string{
			filepath.Join(local, "Google", "Chrome", "User Data"),
			filepath.Join(local, "Google", "Chrome Beta", "User Data"),
			filepath.Join(local, "Google", "Chrome SxS", "User Data"),
			filepath.Join(local, "Chromium", "User Data"),
			filepath.Join(local, "Microsoft", "Edge", "User Data"),
			filepath.Join(local, "Microsoft", "Edge Beta", "User Data"),
			filepath.Join(local, "Microsoft", "Edge Dev", "User Data"),
			filepath.Join(local, "BraveSoftware", "Brave-Browser", "User Data"),
		}
	default:
		config := filepath.Join(home, ".config")
		return []string{
			filepath.Join(config, "google-chrome"),
			filepath.Join(config, "google-chrome-beta"),
			filepath.Join(config, "google-chrome-unstable"),
			filepath.Join(config, "chromium"),
			filepath.Join(config, "microsoft-edge"),
			filepath.Join(config, "microsoft-edge-beta"),
			filepath.Join(config, "microsoft-edge-dev"),
			filepath.Join(config, "BraveSoftware", "Brave-Browser"),
			filepath.Join(config, "BraveSoftware", "Brave-Browser-Beta"),
		}
	}
}
