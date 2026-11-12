package uistate

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/paths"
)

// bodyKeys are the bulky per-session fields. They live in sessions/<id>.json.
// Everything else on a session (title, timestamps, ACP ids, pin) stays in the
// ui-state.json index so the index can be read and written on its own.
var bodyKeys = []string{"messages", "todos", "artifacts", "pendingForkContext"}

func isBodyKey(key string) bool {
	for _, candidate := range bodyKeys {
		if candidate == key {
			return true
		}
	}
	return false
}

// loadSplit reads ui-state.json and returns it with every session's messages
// attached, which is the shape the panel has always spoken. A file that still
// carries messages inline is backed up and split first.
//
// hashes maps session id to the body hash currently on disk, so a later save can
// skip rewriting transcripts that did not change. A missing file is not an error.
func loadSplit(path string) (map[string]any, map[string]string, error) {
	state, ok := readMap(path)
	if !ok {
		return nil, nil, nil
	}
	if hasInlineBodies(state) {
		if err := backupState(path); err != nil {
			return nil, nil, err
		}
		if err := writeSplit(path, state, nil); err != nil {
			return nil, nil, err
		}
		log.Log("ui-state split into per-session files under " + filepath.Dir(path))
		state, ok = readMap(path)
		if !ok {
			return nil, nil, fmt.Errorf("split state %s is unreadable", path)
		}
	}
	hashes := indexHashes(state)
	hydrate(path, state)
	return state, hashes, nil
}

func hasInlineBodies(state map[string]any) bool {
	for _, session := range sessionList(state["sessions"]) {
		if bodyPresent(session) {
			return true
		}
	}
	return false
}

func bodyPresent(session map[string]any) bool {
	if messages, ok := session["messages"].([]any); ok && len(messages) > 0 {
		return true
	}
	if text := str(session["pendingForkContext"]); text != "" {
		return true
	}
	if todos, ok := session["todos"].([]any); ok && len(todos) > 0 {
		return true
	}
	if artifacts, ok := session["artifacts"].([]any); ok && len(artifacts) > 0 {
		return true
	}
	return false
}

func archived(session map[string]any) bool {
	return str(session["archivedAt"]) != ""
}

func sessionList(raw any) []map[string]any {
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if session, ok := item.(map[string]any); ok {
			out = append(out, session)
		}
	}
	return out
}

func indexHashes(state map[string]any) map[string]string {
	out := map[string]string{}
	if hasInlineBodies(state) {
		return out
	}
	for _, session := range sessionList(state["sessions"]) {
		id := str(session["id"])
		hash := str(session["bodyHash"])
		if id != "" && hash != "" {
			out[id] = hash
		}
	}
	return out
}

func hydrate(statePath string, state map[string]any) {
	for _, session := range sessionList(state["sessions"]) {
		if archived(session) {
			// 正文留在 sessions/<id>.json 里就是归档件；不要自动灌回侧栏，否则体积预算
			// 立刻失效（归档后第一次打开面板就把老会话又全量拉进内存）。
			session["messages"] = []any{}
			session["todos"] = []any{}
			session["artifacts"] = []any{}
			delete(session, "pendingForkContext")
			delete(session, "bodyHash")
			continue
		}
		if file, ok := sessionFile(statePath, str(session["id"])); ok {
			if body, ok := readMap(file); ok {
				for _, key := range bodyKeys {
					if value, exists := body[key]; exists {
						session[key] = value
					}
				}
			}
		}
		if _, exists := session["messages"]; !exists {
			session["messages"] = []any{}
		}
		delete(session, "bodyHash")
	}
}

// writeSplit persists the index without message bodies and writes each session
// file whose content changed. prev is the hash of the body already on disk;
// a match skips the rewrite. Orphan files are removed only after the index
// lands, so a crash cannot drop a transcript the index still names.
func writeSplit(statePath string, state map[string]any, prev map[string]string) error {
	if state == nil {
		state = map[string]any{}
	}
	sessions := sessionList(state["sessions"])
	slim := make([]any, 0, len(sessions))
	keep := map[string]bool{}
	for _, session := range sessions {
		id := str(session["id"])
		if id == "" {
			continue
		}
		meta, body := splitSession(session)
		if archived(session) {
			// 归档会话的正文就是磁盘上的旧文件。侧栏送来的已经是空 body，绝不能拿它覆盖；
			// 保留旧 hash 并让 removeOrphans 留下这个文件，恢复时再读回来。
			if prevHash := prev[id]; prevHash != "" {
				meta["bodyHash"] = prevHash
			}
			slim = append(slim, meta)
			if file, ok := sessionFile(statePath, id); ok {
				if _, err := os.Stat(file); err == nil {
					keep[filepath.Base(file)] = true
				}
			}
			continue
		}
		// Session bodies are machine-written and machine-read (the index stays indented
		// for a human eye): compact JSON keeps a 30MB state from writing 40MB every
		// time — same bytes the panel sent, hashed and stored as-is.
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		raw = append(raw, '\n')
		sum := sha256.Sum256(raw)
		hash := hex.EncodeToString(sum[:])
		meta["bodyHash"] = hash
		slim = append(slim, meta)
		file, ok := sessionFile(statePath, id)
		if !ok {
			continue
		}
		keep[filepath.Base(file)] = true
		if prev[id] == hash {
			if _, err := os.Stat(file); err == nil {
				continue
			}
		}
		if err := writeAtomic(file, raw); err != nil {
			return err
		}
	}
	out := map[string]any{}
	for key, value := range state {
		out[key] = value
	}
	out["sessions"] = slim
	raw, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	if err := writeAtomic(statePath, append(raw, '\n')); err != nil {
		return err
	}
	removeOrphans(statePath, keep)
	return nil
}

func splitSession(session map[string]any) (meta, body map[string]any) {
	meta = map[string]any{}
	body = map[string]any{}
	for key, value := range session {
		if key == "bodyHash" || isBodyKey(key) {
			continue
		}
		meta[key] = value
	}
	if id := str(session["id"]); id != "" {
		body["id"] = id
	}
	if updated := str(session["updatedAt"]); updated != "" {
		body["updatedAt"] = updated
	}
	for _, key := range bodyKeys {
		if value, ok := session[key]; ok {
			body[key] = value
		}
	}
	if _, ok := body["messages"]; !ok {
		body["messages"] = []any{}
	}
	return meta, body
}

// ReadSessionBody returns the archived body (messages / todos / artifacts /
// pendingForkContext) for a session id. The active index only carries metadata;
// the full body stays in sessions/<id>.json.
func ReadSessionBody(id string) (map[string]any, bool) {
	file, ok := sessionFile(paths.UIStatePath(), id)
	if !ok {
		return nil, false
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, false
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, false
	}
	return body, true
}

// ArchiveSessions drops the bodies of the given sessions from the active index
// while keeping their sessions/<id>.json files. It refuses to archive a session
// whose body file is missing: the panel has already cleared its copy by then, so
// archiving would destroy the only transcript. Returns the timestamp applied to
// the archived ids and the ids that were skipped for that reason.
func ArchiveSessions(ids []string, running map[string]bool) (archivedAt string, archivedIDs, skippedIDs []string, err error) {
	if len(ids) == 0 {
		return "", nil, nil, nil
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	path := paths.UIStatePath()
	state, hashes, loadErr := loadSplit(path)
	if loadErr != nil {
		return "", nil, nil, loadErr
	}
	if state == nil {
		return "", nil, append(skippedIDs, ids...), nil
	}
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id != "" {
			wanted[id] = true
		}
	}
	archivedAt = time.Now().UTC().Format(time.RFC3339)
	for _, session := range sessionList(state["sessions"]) {
		id := str(session["id"])
		if !wanted[id] {
			continue
		}
		file, ok := sessionFile(path, id)
		if !ok {
			skippedIDs = append(skippedIDs, id)
			continue
		}
		if _, statErr := os.Stat(file); statErr != nil {
			// 幂等重试也一样要核对文件：盘上没有正文就绝不告诉面板「可以清」。
			skippedIDs = append(skippedIDs, id)
			continue
		}
		if sessionRunning(session, running) {
			// Host 里这条会话还有一轮在跑：绝不归档（面板可能刚重开，还不知道后台任务）。
			skippedIDs = append(skippedIDs, id)
			continue
		}
		if archived(session) {
			archivedIDs = append(archivedIDs, id)
			continue
		}
		session["archivedAt"] = archivedAt
		session["messages"] = []any{}
		session["todos"] = []any{}
		session["artifacts"] = []any{}
		delete(session, "pendingForkContext")
		archivedIDs = append(archivedIDs, id)
	}
	if len(archivedIDs) == 0 {
		return "", nil, skippedIDs, nil
	}
	if err := writeSplit(path, state, hashes); err != nil {
		return "", nil, nil, err
	}
	return archivedAt, archivedIDs, skippedIDs, nil
}

// sessionRunning matches a session's ACP ids against the host's in-flight set.
func sessionRunning(session map[string]any, running map[string]bool) bool {
	if len(running) == 0 {
		return false
	}
	if running[str(session["acpSessionId"])] {
		return true
	}
	if providers, ok := session["acpByProvider"].(map[string]any); ok {
		for _, value := range providers {
			if running[str(value)] {
				return true
			}
		}
	}
	return false
}

func sessionFile(statePath, id string) (string, bool) {
	base := sessionFileBase(id)
	if statePath == "" || base == "" {
		return "", false
	}
	return filepath.Join(filepath.Dir(statePath), "sessions", base), true
}

func sessionFileBase(id string) string {
	if id == "" || len(id) > 128 {
		return ""
	}
	for _, r := range id {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' && r != '_' {
			sum := sha256.Sum256([]byte(id))
			return "id-" + hex.EncodeToString(sum[:8]) + ".json"
		}
	}
	return id + ".json"
}

func removeOrphans(statePath string, keep map[string]bool) {
	dir := filepath.Join(filepath.Dir(statePath), "sessions")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".json") || keep[name] {
			continue
		}
		_ = os.Remove(filepath.Join(dir, name))
	}
}

// backupState copies the still-inline state file aside before it is rewritten.
// The copy is the recoverable history; the rewrite does not happen if this fails.
func backupState(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	target := fmt.Sprintf("%s.sessions-backup-%s", path, time.Now().Format("20060102-150405.000"))
	return writeAtomic(target, raw)
}

func readMap(path string) (map[string]any, bool) {
	if path == "" {
		return nil, false
	}
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 {
		return nil, false
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, false
	}
	return out, true
}

func writeAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".tmp-"+filepath.Base(path)+"-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)

	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Chmod(0o644); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
