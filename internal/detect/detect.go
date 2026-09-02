package detect

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/parksben/cursor-sidebar/internal/log"
	"github.com/parksben/cursor-sidebar/internal/paths"
	"github.com/parksben/cursor-sidebar/internal/protocol"
)

type ResolvedAgent struct {
	Profile AgentProfile
	Command string
	Args    []string
}

func ResolveOnPath(command string) string {
	if command == "" {
		return ""
	}
	if filepath.IsAbs(command) {
		if isExecutable(command) {
			return command
		}
		return ""
	}
	for _, dir := range paths.AgentSearchDirs() {
		if found := resolveInDir(dir, command); found != "" {
			return found
		}
	}
	return ""
}

func resolveInDir(dir, command string) string {
	base := filepath.Join(dir, command)
	if isExecutable(base) {
		return base
	}
	if filepath.Ext(command) != "" {
		return ""
	}
	for _, ext := range paths.PathExts() {
		if ext == "" {
			continue
		}
		full := base + ext
		if isExecutable(full) {
			return full
		}
	}
	return ""
}

func isExecutable(path string) bool {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return false
	}
	if st.Mode()&0o111 != 0 {
		return true
	}
	// Windows files are executable if they exist with a PATHEXT suffix.
	ext := strings.ToLower(filepath.Ext(path))
	for _, item := range paths.PathExts() {
		if item != "" && strings.ToLower(item) == ext {
			return true
		}
	}
	return false
}

func ProbeACP(command string, args []string, timeout time.Duration) bool {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, command, args...)
	env := os.Environ()
	env = setEnv(env, "HOME", paths.Home())
	env = setEnv(env, "PATH", paths.AgentPathEnv(command))
	cmd.Env = env
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return false
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return false
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return false
	}
	done := make(chan bool, 1)
	go func() {
		ok := false
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			var msg map[string]any
			if err := json.Unmarshal([]byte(line), &msg); err != nil {
				continue
			}
			if result, ok := msg["result"].(map[string]any); ok {
				if _, has := result["protocolVersion"]; has {
					ok = true
					break
				}
			}
		}
		done <- ok
	}()
	init := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": 1,
			"clientCapabilities": map[string]any{
				"fs":       map[string]any{"readTextFile": false, "writeTextFile": false},
				"terminal": false,
			},
			"clientInfo": map[string]any{"name": "opensider", "version": "0.1.0"},
		},
	}
	raw, _ := json.Marshal(init)
	_, _ = stdin.Write(append(raw, '\n'))
	var ok bool
	select {
	case ok = <-done:
	case <-ctx.Done():
		ok = false
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	return ok
}

func resolveLaunch(profile AgentProfile) *ResolvedAgent {
	var found *ResolvedAgent
	for _, launch := range profile.Launches {
		command := ResolveOnPath(launch.Command)
		if command == "" {
			continue
		}
		if found == nil {
			found = &ResolvedAgent{Profile: profile, Command: command, Args: launch.Args}
		}
		if ProbeACP(command, launch.Args, 5*time.Second) {
			log.Log("detect " + profile.ID + " ok " + command + " " + strings.Join(launch.Args, " "))
			return &ResolvedAgent{Profile: profile, Command: command, Args: launch.Args}
		}
		log.Log("detect " + profile.ID + " probe failed " + command + " " + strings.Join(launch.Args, " "))
	}
	if found != nil {
		log.Log("detect " + profile.ID + " installed, handshake skipped " + found.Command)
		return found
	}
	log.Log("detect " + profile.ID + " miss")
	return nil
}

type registryAgent struct {
	Name    string   `json:"name"`
	Title   string   `json:"title"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

func registryExtras() []AgentProfile {
	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json", nil)
	if err != nil {
		return nil
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Log("acp registry skipped: " + err.Error())
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil
	}
	var asList []registryAgent
	var asObj struct {
		Agents []registryAgent `json:"agents"`
	}
	list := asList
	if err := json.Unmarshal(body, &asList); err == nil && len(asList) > 0 {
		list = asList
	} else if err := json.Unmarshal(body, &asObj); err == nil {
		list = asObj.Agents
	}
	known := map[string]bool{}
	for _, p := range Profiles() {
		for _, launch := range p.Launches {
			known[launch.Command] = true
		}
	}
	var extras []AgentProfile
	nonWord := regexp.MustCompile(`[^a-z0-9-]+`)
	for _, item := range list {
		command := strings.TrimSpace(item.Command)
		if command == "" || known[command] {
			continue
		}
		id := strings.ToLower(nonWord.ReplaceAllString(command, "-"))
		name := item.Title
		if name == "" {
			name = item.Name
		}
		if name == "" {
			name = command
		}
		args := item.Args
		if args == nil {
			args = []string{"acp"}
		}
		extras = append(extras, GenericProfile(id, name, command, args))
		known[command] = true
	}
	return extras
}

func DetectAgents() (infos []protocol.AgentInfo, resolved []ResolvedAgent) {
	catalog := append(Profiles(), registryExtras()...)
	for _, profile := range catalog {
		if hit := resolveLaunch(profile); hit != nil {
			resolved = append(resolved, *hit)
		}
	}
	for _, item := range resolved {
		cmd := strings.TrimSpace(item.Command + " " + strings.Join(item.Args, " "))
		infos = append(infos, protocol.AgentInfo{
			ID:        item.Profile.ID,
			Name:      item.Profile.Name,
			Mark:      item.Profile.Mark,
			Command:   cmd,
			Installed: true,
			Hint:      item.Profile.LoginHint,
			Caps:      item.Profile.Caps,
		})
	}
	return infos, resolved
}

var resolvedCache sync.Map

func RememberResolved(item ResolvedAgent) {
	resolvedCache.Store(item.Profile.ID, item)
}

func CachedResolved(id string) *ResolvedAgent {
	if v, ok := resolvedCache.Load(id); ok {
		item := v.(ResolvedAgent)
		return &item
	}
	return nil
}

func ResolveProfile(id string) *ResolvedAgent {
	if cached := CachedResolved(id); cached != nil {
		return cached
	}
	profile := ProfileByID(id)
	if profile == nil {
		g := GenericProfile(id, id, id, []string{"acp"})
		profile = &g
	}
	hit := resolveLaunch(*profile)
	if hit != nil {
		RememberResolved(*hit)
	}
	return hit
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
