package pick

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/protocol"
)

type Mode = protocol.PickMode

const (
	ModeMixed   = protocol.PickMixed
	ModeFiles   = protocol.PickFiles
	ModeFolders = protocol.PickFolders
)

var imageExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".svg": true, ".bmp": true, ".ico": true, ".heic": true, ".heif": true,
	".tif": true, ".tiff": true, ".avif": true, ".jxl": true,
}

func ParseMode(s string) Mode {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "files":
		return ModeFiles
	case "folders", "folder":
		return ModeFolders
	default:
		return ModeMixed
	}
}

func ClassifyPath(path string) protocol.AttachmentItem {
	clean := strings.TrimRight(path, `/\`)
	kind := protocol.KindFile
	if st, err := os.Stat(clean); err == nil {
		if st.IsDir() {
			kind = protocol.KindFolder
		} else if imageExt[strings.ToLower(filepath.Ext(clean))] {
			kind = protocol.KindImage
		}
	} else if imageExt[strings.ToLower(filepath.Ext(clean))] {
		kind = protocol.KindImage
	}
	name := filepath.Base(clean)
	if name == "" || name == "." {
		name = clean
	}
	return protocol.AttachmentItem{Path: clean, Name: name, Kind: kind}
}

func ParsePaths(text string) []string {
	var out []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func ToItems(paths []string) []protocol.AttachmentItem {
	seen := map[string]bool{}
	var items []protocol.AttachmentItem
	for _, path := range paths {
		if seen[path] {
			continue
		}
		seen[path] = true
		items = append(items, ClassifyPath(path))
	}
	return items
}

func writeDest(dest string, paths []string) error {
	text := ""
	if len(paths) > 0 {
		text = strings.Join(paths, "\n") + "\n"
	}
	if dest == "" {
		_, err := os.Stdout.WriteString(text)
		return err
	}
	return os.WriteFile(dest, []byte(text), 0o644)
}

// RunCLI is `opensider pick [--mode=...] [dest]`.
func RunCLI(args []string) error {
	mode := ModeMixed
	var dest string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--mode" && i+1 < len(args):
			i++
			mode = ParseMode(args[i])
		case strings.HasPrefix(arg, "--mode="):
			mode = ParseMode(strings.TrimPrefix(arg, "--mode="))
		case strings.HasPrefix(arg, "-") && arg != "-":
			return fmt.Errorf("unknown pick flag: %s", arg)
		default:
			if dest == "" {
				dest = arg
			}
		}
	}
	log.Log(fmt.Sprintf("pick-files launched dest=%s mode=%s", destOrDash(dest), mode))
	paths, err := dialog(mode)
	if err != nil {
		return err
	}
	return writeDest(dest, paths)
}

func destOrDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// LocalPaths execs this binary as a separate process so the OS dialog can come to the front.
func LocalPaths(mode Mode) (items []protocol.AttachmentItem, cancelled bool, err error) {
	if mode == "" {
		mode = ModeMixed
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, false, err
	}
	dest := filepath.Join(os.TempDir(), fmt.Sprintf("opensider-pick-%d-%d.txt", os.Getpid(), time.Now().UnixNano()))
	if err := os.WriteFile(dest, nil, 0o644); err != nil {
		return nil, false, err
	}
	defer os.Remove(dest)

	started := time.Now()
	log.Log("file pick exec " + exe + " pick --mode=" + string(mode))
	cmd := exec.Command(exe, "pick", "--mode="+string(mode), dest)
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	runErr := cmd.Run()
	raw, _ := os.ReadFile(dest)
	found := ParsePaths(string(raw))
	log.Log(fmt.Sprintf("file pick app done ms=%d count=%d", time.Since(started).Milliseconds(), len(found)))
	if runErr != nil && len(found) == 0 {
		detail := runErr.Error()
		if isCancel(detail) {
			return nil, true, nil
		}
		log.Log("file pick failed: " + detail)
		return nil, false, runErr
	}
	if len(found) == 0 && time.Since(started) < 400*time.Millisecond {
		return nil, false, fmt.Errorf("picker exited before a panel could appear")
	}
	if len(found) == 0 {
		return nil, true, nil
	}
	return ToItems(found), false, nil
}

func isCancel(detail string) bool {
	lower := strings.ToLower(detail)
	return strings.Contains(lower, "-128") || strings.Contains(lower, "user canceled") ||
		strings.Contains(lower, "user cancelled") || strings.Contains(lower, "cancelled")
}
