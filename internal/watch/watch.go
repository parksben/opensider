package watch

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/protocol"
)

var processed sync.Map

func WatchCommands(onCommand func(command protocol.BrowserCommand)) error {
	_ = os.MkdirAll(paths.CommandsDir(), 0o755)
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	if err := watcher.Add(paths.CommandsDir()); err != nil {
		_ = watcher.Close()
		return err
	}
	go func() {
		defer watcher.Close()
		for {
			select {
			case ev, ok := <-watcher.Events:
				if !ok {
					return
				}
				if !strings.HasSuffix(ev.Name, ".json") {
					continue
				}
				if ev.Has(fsnotify.Create) || ev.Has(fsnotify.Write) {
					readCommand(ev.Name, onCommand)
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				if err != nil {
					log.Log("watch error: " + err.Error())
				}
			}
		}
	}()
	return nil
}

func readCommand(file string, onCommand func(command protocol.BrowserCommand)) {
	var last error
	for i := 0; i < 8; i++ {
		raw, err := os.ReadFile(file)
		if err != nil {
			last = err
			time.Sleep(20 * time.Millisecond)
			continue
		}
		var cmd protocol.BrowserCommand
		if err := json.Unmarshal(raw, &cmd); err != nil {
			return
		}
		if cmd.ID == "" || !protocol.IsPageMethod(cmd.Method) {
			return
		}
		if _, loaded := processed.LoadOrStore(cmd.ID, true); loaded {
			return
		}
		onCommand(cmd)
		return
	}
	if last != nil {
		log.Log("read command skipped: " + last.Error())
	}
}

func WriteCommandResult(result protocol.BrowserResult) error {
	stored := result
	if payload, ok := screenshotPayload(result.Data); ok {
		p := filepath.Join(paths.ScreenshotsDir(), result.ID+".jpg")
		data, err := base64.StdEncoding.DecodeString(payload.ImageBase64)
		if err != nil {
			return err
		}
		_ = os.MkdirAll(paths.ScreenshotsDir(), 0o755)
		if err := os.WriteFile(p, data, 0o644); err != nil {
			return err
		}
		stored.Data = map[string]any{
			"path":   p,
			"mime":   payload.Mime,
			"width":  payload.Width,
			"height": payload.Height,
		}
		log.Log("wrote screenshot " + p)
	}
	file := filepath.Join(paths.ResultsDir(), result.ID+".json")
	raw, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(file, append(raw, '\n'), 0o644); err != nil {
		return err
	}
	ok := "false"
	if result.OK {
		ok = "true"
	}
	log.Log("wrote result " + result.ID + " ok=" + ok)
	return nil
}

func screenshotPayload(data any) (protocol.ScreenshotPayload, bool) {
	obj, ok := data.(map[string]any)
	if !ok {
		return protocol.ScreenshotPayload{}, false
	}
	image, _ := obj["imageBase64"].(string)
	if image == "" {
		return protocol.ScreenshotPayload{}, false
	}
	mime, _ := obj["mime"].(string)
	width, _ := asInt(obj["width"])
	height, _ := asInt(obj["height"])
	return protocol.ScreenshotPayload{ImageBase64: image, Mime: mime, Width: width, Height: height}, true
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}
