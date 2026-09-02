package install

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/workspace"
)

const (
	extensionZipURL = "https://github.com/parksben/opensider/releases/latest/download/extension.zip"
	previousHost    = "com.cursor.sidebar.host"
)

func Run(local bool) error {
	if err := os.MkdirAll(paths.CommandsDir(), 0o755); err != nil {
		return err
	}
	_ = os.MkdirAll(paths.ResultsDir(), 0o755)
	_ = os.MkdirAll(paths.ScreenshotsDir(), 0o755)
	_ = os.MkdirAll(paths.PastedDir(), 0o755)
	_ = os.MkdirAll(paths.OutputsDir(), 0o755)
	_ = os.MkdirAll(paths.RuntimeDir(), 0o755)
	workspace.Ensure()

	bin := paths.RuntimeBinaryPath()
	if local {
		if err := buildLocal(bin); err != nil {
			return err
		}
		if err := copyLocalExtension(); err != nil {
			return err
		}
	} else {
		if err := copySelf(bin); err != nil {
			return err
		}
		if err := ensureReleasedExtension(); err != nil {
			return err
		}
	}

	if err := os.Chmod(bin, 0o755); err != nil && runtime.GOOS != "windows" {
		return err
	}
	abs, err := filepath.Abs(bin)
	if err != nil {
		return err
	}
	dirs, err := Register(abs)
	if err != nil {
		return err
	}
	fmt.Printf("Registered %s\n", protocol.HostName)
	fmt.Printf("Host: %s\n", abs)
	fmt.Printf("Allowed origins: chrome-extension://%s/ chrome-extension://%s/\n", protocol.ExtensionID, protocol.PackedExtensionID)
	fmt.Printf("Workspace: %s\n", paths.WorkspaceDir())
	fmt.Printf("Extension: %s\n", paths.ExtensionDir())
	fmt.Printf("Manifests: %s\n", strings.Join(dirs, ", "))
	log.Log("install complete host=" + abs)
	return nil
}

func buildLocal(dest string) error {
	root := findModuleRoot()
	if root == "" {
		return fmt.Errorf("install --local needs the OpenSider repo (go.mod not found from %s)", mustWd())
	}
	goBin := findGo()
	if goBin == "" {
		return fmt.Errorf("go toolchain not found on PATH")
	}
	_ = os.MkdirAll(filepath.Dir(dest), 0o755)
	cmd := exec.Command(goBin, "build", "-o", dest, "./cmd/opensider")
	cmd.Dir = root
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	env := os.Environ()
	if runtime.GOOS == "darwin" {
		env = setEnv(env, "CGO_ENABLED", "1")
	}
	cmd.Env = env
	fmt.Printf("Building %s from %s\n", dest, root)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("go build: %w", err)
	}
	return nil
}

func copyLocalExtension() error {
	root := findModuleRoot()
	if root == "" {
		return nil
	}
	src := filepath.Join(root, "packages", "extension", "dist")
	if _, err := os.Stat(filepath.Join(src, "manifest.json")); err != nil {
		fmt.Println("packages/extension/dist not found; skip copying extension")
		return nil
	}
	dest := paths.ExtensionDir()
	if err := os.RemoveAll(dest); err != nil {
		return err
	}
	if err := copyDir(src, dest); err != nil {
		return err
	}
	fmt.Printf("Copied extension %s -> %s\n", src, dest)
	return nil
}

func copySelf(dest string) error {
	src, err := os.Executable()
	if err != nil {
		return err
	}
	src, err = filepath.EvalSymlinks(src)
	if err != nil {
		src, _ = os.Executable()
	}
	absDest, _ := filepath.Abs(dest)
	if sameFile(src, absDest) {
		return nil
	}
	_ = os.MkdirAll(filepath.Dir(dest), 0o755)
	tmp := dest + ".tmp"
	if err := copyFile(src, tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(dest)
		if err2 := os.Rename(tmp, dest); err2 != nil {
			return err
		}
	}
	return nil
}

func ensureReleasedExtension() error {
	manifest := filepath.Join(paths.ExtensionDir(), "manifest.json")
	if _, err := os.Stat(manifest); err == nil {
		return nil
	}
	fmt.Printf("Downloading %s\n", extensionZipURL)
	tmp, err := os.CreateTemp("", "opensider-extension-*.zip")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	resp, err := http.Get(extensionZipURL)
	if err != nil {
		_ = tmp.Close()
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		_ = tmp.Close()
		return fmt.Errorf("download extension.zip: HTTP %s", resp.Status)
	}
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	dest := paths.ExtensionDir()
	_ = os.RemoveAll(dest)
	return unzip(tmpPath, dest)
}

func findModuleRoot() string {
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	dir := wd
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "cmd", "opensider")); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func findGo() string {
	if p, err := exec.LookPath("go"); err == nil {
		return p
	}
	for _, cand := range []string{
		"/opt/homebrew/bin/go",
		"/usr/local/go/bin/go",
		"/usr/local/bin/go",
		`C:\Program Files\Go\bin\go.exe`,
	} {
		if _, err := os.Stat(cand); err == nil {
			return cand
		}
	}
	return ""
}

func mustWd() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func copyDir(src, dest string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dest, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func sameFile(a, b string) bool {
	ai, err1 := os.Stat(a)
	bi, err2 := os.Stat(b)
	if err1 != nil || err2 != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return os.SameFile(ai, bi)
}

func unzip(zipPath, dest string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	for _, f := range r.File {
		name := filepath.Clean(f.Name)
		if strings.HasPrefix(name, "..") {
			continue
		}
		target := filepath.Join(dest, name)
		rel, err := filepath.Rel(dest, target)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(target, 0o755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
		if err != nil {
			_ = rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		_ = out.Close()
		_ = rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func setEnv(env []string, key, value string) []string {
	prefix := key + "="
	for i, item := range env {
		if strings.HasPrefix(item, prefix) {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}
