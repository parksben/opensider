package host

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/parksben/opensider/internal/acp"
	"github.com/parksben/opensider/internal/detect"
	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/models"
	"github.com/parksben/opensider/internal/native"
	"github.com/parksben/opensider/internal/paths"
	"github.com/parksben/opensider/internal/pick"
	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/reveal"
	"github.com/parksben/opensider/internal/watch"
	"github.com/parksben/opensider/internal/workspace"
)

type acpRuntime struct {
	client    *acp.Client
	prompting bool
	binding   bool
}

type Host struct {
	io             *native.IO
	mu             sync.Mutex
	bindMu         sync.Mutex
	runtimes       []*acpRuntime
	rpcClients     map[int]*acp.Client
	catalog        models.Catalog
	pendingModelID string
	currentAgent   *detect.ResolvedAgent
	currentPolicy  protocol.AgentPolicy
	lastAgents     []protocol.AgentInfo
	hostState      string
}

func Run() {
	log.Log("go host starting")
	workspace.Ensure()
	h := &Host{
		rpcClients:    map[int]*acp.Client{},
		currentPolicy: protocol.PolicyAsk,
		hostState:     "starting",
		catalog:       models.Catalog{ModelConfigID: "model"},
	}
	h.io = native.New(func(msg map[string]any) {
		go h.handleExt(msg)
	})
	h.main()
	<-h.io.Done
	h.mu.Lock()
	runtimes := append([]*acpRuntime{}, h.runtimes...)
	h.mu.Unlock()
	for _, runtime := range runtimes {
		runtime.client.Stop()
	}
}

func (h *Host) main() {
	h.setHostState("starting", "")
	go h.scanAndIdle()
	if err := watch.WatchCommands(func(command protocol.BrowserCommand) {
		h.handleWorkspaceCommand(command)
	}); err != nil {
		log.Log("watch commands: " + err.Error())
	}
}

func (h *Host) scanAndIdle() {
	if err := h.scanAgents(); err != nil {
		log.Log("detect failed: " + err.Error())
		h.setHostState("error", err.Error())
		return
	}
	h.setHostState("idle", "")
	h.logIdleAgents()
	go h.scanRegistry()
}

func (h *Host) scanRegistry() {
	h.mu.Lock()
	existing := append([]detect.ResolvedAgent{}, resolvedFromInfos(h.lastAgents)...)
	h.mu.Unlock()
	// Re-resolve from cache first; registry extras are merged by path.
	cached := make([]detect.ResolvedAgent, 0, len(existing))
	for _, item := range existing {
		if hit := detect.CachedResolved(item.Profile.ID); hit != nil {
			cached = append(cached, *hit)
		}
	}
	infos, resolved := detect.DetectRegistryExtras(cached)
	if len(resolved) == len(cached) {
		return
	}
	h.mu.Lock()
	h.lastAgents = infos
	h.mu.Unlock()
	for _, item := range resolved {
		detect.RememberResolved(item)
	}
	h.sendAgents()
	h.logIdleAgents()
}

func (h *Host) logIdleAgents() {
	h.mu.Lock()
	ids := make([]string, 0, len(h.lastAgents))
	for _, item := range h.lastAgents {
		ids = append(ids, item.ID)
	}
	h.mu.Unlock()
	joined := strings.Join(ids, ",")
	if joined == "" {
		joined = "none"
	}
	log.Log("idle agents=" + joined)
}

func resolvedFromInfos(infos []protocol.AgentInfo) []detect.ResolvedAgent {
	out := make([]detect.ResolvedAgent, 0, len(infos))
	for _, item := range infos {
		if hit := detect.CachedResolved(item.ID); hit != nil {
			out = append(out, *hit)
		}
	}
	return out
}

func (h *Host) send(msg any) {
	h.io.Send(msg)
}

func (h *Host) sendModels() {
	h.mu.Lock()
	models := h.catalog.Models
	current := h.catalog.CurrentID
	h.mu.Unlock()
	if models == nil {
		models = []protocol.AgentModel{}
	}
	h.send(map[string]any{"type": "models", "models": models, "currentId": current})
}

func (h *Host) setHostState(state, errText string) {
	h.mu.Lock()
	h.hostState = state
	h.mu.Unlock()
	msg := map[string]any{"type": "status", "state": state}
	if errText != "" {
		msg["error"] = errText
	}
	h.send(msg)
}

func (h *Host) sendAgents() {
	h.mu.Lock()
	agents := h.lastAgents
	var selected string
	if h.currentAgent != nil {
		selected = h.currentAgent.Profile.ID
	}
	h.mu.Unlock()
	if agents == nil {
		agents = []protocol.AgentInfo{}
	}
	msg := map[string]any{"type": "agents", "agents": agents}
	if selected != "" {
		msg["selectedId"] = selected
	}
	h.send(msg)
}

func (h *Host) sendProgress(index, total int, phase, label string) {
	h.send(map[string]any{
		"type":     "agent.progress",
		"progress": protocol.AgentProgress{Phase: phase, Index: index, Total: total, Label: label},
	})
}

func (h *Host) sendHello() {
	h.mu.Lock()
	agentPath := ""
	var providerID string
	if h.currentAgent != nil {
		agentPath = h.currentAgent.Command
		providerID = h.currentAgent.Profile.ID
	}
	h.mu.Unlock()
	msg := map[string]any{
		"type":      "hello",
		"workspace": paths.WorkspaceDir(),
		"agentPath": agentPath,
	}
	if providerID != "" {
		msg["providerId"] = providerID
	}
	h.send(msg)
}

func (h *Host) scanAgents() error {
	infos, resolved := detect.DetectAgents()
	h.mu.Lock()
	h.lastAgents = infos
	h.mu.Unlock()
	for _, item := range resolved {
		detect.RememberResolved(item)
	}
	h.sendAgents()
	return nil
}

func (h *Host) stopRuntimes() {
	h.mu.Lock()
	runtimes := h.runtimes
	h.runtimes = nil
	h.rpcClients = map[int]*acp.Client{}
	h.mu.Unlock()
	for _, runtime := range runtimes {
		func() {
			defer func() { _ = recover() }()
			runtime.client.Stop()
		}()
	}
}

func (h *Host) connectAgent(providerID string, policy protocol.AgentPolicy) error {
	h.setHostState("connecting", "")
	if policy != "" {
		h.mu.Lock()
		h.currentPolicy = policy
		h.mu.Unlock()
	}
	h.sendProgress(1, 6, "resolve", "Resolving CLI")
	resolved := detect.CachedResolved(providerID)
	if resolved == nil {
		resolved = detect.ResolveProfile(providerID)
	}
	if resolved == nil {
		return fmt.Errorf("Could not find an ACP CLI for %s.", providerID)
	}
	h.mu.Lock()
	h.currentAgent = resolved
	h.mu.Unlock()
	detect.RememberResolved(*resolved)

	h.sendProgress(2, 6, "spawn", "Starting process")
	h.stopRuntimes()
	h.mu.Lock()
	h.catalog = models.Catalog{ModelConfigID: "model"}
	h.mu.Unlock()
	h.sendModels()
	runtime := &acpRuntime{}
	if err := h.attachClient(runtime); err != nil {
		return err
	}
	if err := runtime.client.Start(); err != nil {
		return err
	}
	h.sendProgress(3, 6, "handshake", "ACP handshake")
	h.sendProgress(4, 6, "auth", "Signing in")
	if err := runtime.client.Initialize(); err != nil {
		return err
	}
	h.mu.Lock()
	h.runtimes = append(h.runtimes, runtime)
	count := len(h.runtimes)
	h.mu.Unlock()
	log.Log(fmt.Sprintf("acp runtime ready provider=%s count=%d", resolved.Profile.ID, count))

	h.sendProgress(5, 6, "session", "Ready for sessions")
	h.sendProgress(6, 6, "models", "Loading models")
	h.refreshModels()
	h.applyFallbackModels()
	h.sendModels()
	h.sendAgents()
	h.sendHello()
	h.setHostState("ready", "")
	return nil
}

func (h *Host) refreshModels() {
	h.mu.Lock()
	agent := h.currentAgent
	h.mu.Unlock()
	if agent == nil || agent.Profile.ListModels != "agent-models" {
		return
	}
	catalog := models.ListAgentModels(agent.Command)
	h.mu.Lock()
	h.catalog = models.MergeCatalog(h.catalog, catalog)
	h.mu.Unlock()
}

func (h *Host) absorbConfigUpdate(update map[string]any) {
	overlay := models.CatalogFromConfigOptions(models.OptionsFromAny(update["configOptions"]))
	h.mu.Lock()
	h.catalog = models.MergeCatalog(h.catalog, overlay)
	h.catalog = models.MergeCatalog(h.catalog, models.CatalogFromSessionModels(update["models"]))
	h.mu.Unlock()
	h.sendModels()
}

func (h *Host) absorbSessionOptions(opened acp.SessionOpen) {
	overlay := models.CatalogFromConfigOptions(models.OptionsFromAny(opened.ConfigOptions))
	h.mu.Lock()
	h.catalog = models.MergeCatalog(h.catalog, overlay)
	h.catalog = models.MergeCatalog(h.catalog, models.CatalogFromSessionModels(opened.Models))
	h.mu.Unlock()
	h.applyFallbackModels()
	h.mu.Lock()
	n := len(h.catalog.Models)
	current := h.catalog.CurrentID
	h.mu.Unlock()
	if n > 0 {
		log.Log(fmt.Sprintf("models %d current=%s", n, current))
	} else {
		opts := models.OptionsFromAny(opened.ConfigOptions)
		var ids []string
		for _, option := range opts {
			id := option.ID
			if id == "" {
				id = option.ConfigID
			}
			ids = append(ids, id)
		}
		joined := strings.Join(ids, ",")
		if joined == "" {
			joined = "none"
		}
		log.Log("models empty options=" + joined)
	}
}

func (h *Host) applyFallbackModels() {
	h.mu.Lock()
	empty := len(h.catalog.Models) == 0
	isCopilot := h.currentAgent != nil && h.currentAgent.Profile.ID == "copilot"
	h.mu.Unlock()
	if !empty || !isCopilot {
		return
	}
	h.mu.Lock()
	h.catalog = models.MergeCatalog(h.catalog, models.CopilotFallbackCatalog())
	n := len(h.catalog.Models)
	h.mu.Unlock()
	log.Log(fmt.Sprintf("models fallback copilot %d", n))
}

func hostErrorText(err error) string {
	text := err.Error()
	if regexp.MustCompile(`EACCES:.*\/\.gemini\b`).MatchString(text) {
		return `Gemini CLI cannot write ~/.gemini (directory is owned by root). Run: sudo chown -R "$(whoami)" ~/.gemini`
	}
	return text
}

func (h *Host) enqueueSessionOp(work func() error) error {
	h.bindMu.Lock()
	defer h.bindMu.Unlock()
	return work()
}

func (h *Host) attachClient(runtime *acpRuntime) error {
	h.mu.Lock()
	agent := h.currentAgent
	policy := h.currentPolicy
	h.mu.Unlock()
	if agent == nil {
		return errors.New("no agent selected")
	}
	client := acp.New(acp.Launch{
		Command: agent.Command,
		Args:    agent.Args,
		Cwd:     paths.WorkspaceDir(),
		Env:     agent.Profile.Env,
		Auth:    agent.Profile.Auth,
		Profile: agent.Profile,
	}, acp.Handlers{
		OnUpdate: func(update map[string]any, sessionID string) {
			if runtime.binding && !runtime.prompting {
				if str(update["sessionUpdate"]) == "config_option_update" {
					h.absorbConfigUpdate(update)
				}
				return
			}
			sid := sessionID
			if sid == "" && runtime.client != nil {
				sid = runtime.client.GetSessionID()
			}
			if str(update["sessionUpdate"]) == "config_option_update" {
				h.absorbConfigUpdate(update)
			}
			h.send(map[string]any{"type": "update", "update": update, "sessionId": sid})
		},
		OnPermission: func(id int, params map[string]any, sessionID string) {
			if runtime.binding && !runtime.prompting {
				return
			}
			h.mu.Lock()
			if runtime.client != nil {
				h.rpcClients[id] = runtime.client
			}
			h.mu.Unlock()
			sid := sessionID
			if sid == "" && runtime.client != nil {
				sid = runtime.client.GetSessionID()
			}
			h.send(map[string]any{"type": "permission", "id": id, "params": params, "sessionId": sid})
		},
		OnCursor: func(id *int, method string, params map[string]any, sessionID string) {
			if runtime.binding && !runtime.prompting {
				return
			}
			if id != nil && runtime.client != nil {
				h.mu.Lock()
				h.rpcClients[*id] = runtime.client
				h.mu.Unlock()
			}
			sid := sessionID
			if sid == "" && runtime.client != nil {
				sid = runtime.client.GetSessionID()
			}
			msg := map[string]any{"type": "cursor", "method": method, "params": params, "sessionId": sid}
			if id != nil {
				msg["id"] = *id
			}
			h.send(msg)
		},
	})
	client.SetPolicy(policy)
	runtime.client = client
	return nil
}

func (h *Host) spawnRuntime() (*acpRuntime, error) {
	runtime := &acpRuntime{}
	if err := h.attachClient(runtime); err != nil {
		return nil, err
	}
	if err := runtime.client.Start(); err != nil {
		return nil, err
	}
	if err := runtime.client.Initialize(); err != nil {
		runtime.client.Stop()
		return nil, err
	}
	h.mu.Lock()
	h.runtimes = append(h.runtimes, runtime)
	count := len(h.runtimes)
	h.mu.Unlock()
	log.Log(fmt.Sprintf("acp runtime ready count=%d", count))
	return runtime, nil
}

func withBinding[T any](runtime *acpRuntime, work func() (T, error)) (T, error) {
	runtime.binding = true
	defer func() { runtime.binding = false }()
	return work()
}

func (h *Host) runtimeBySession(sessionID string) *acpRuntime {
	if sessionID == "" {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, runtime := range h.runtimes {
		if runtime.client.GetSessionID() == sessionID {
			return runtime
		}
	}
	return nil
}

func (h *Host) acquireRuntime(preferSessionID string) (*acpRuntime, error) {
	if owned := h.runtimeBySession(preferSessionID); owned != nil && !owned.prompting {
		return owned, nil
	}
	h.mu.Lock()
	var idle *acpRuntime
	for _, runtime := range h.runtimes {
		if !runtime.prompting {
			idle = runtime
			break
		}
	}
	h.mu.Unlock()
	if idle != nil {
		return idle, nil
	}
	return h.spawnRuntime()
}

func (h *Host) openAndAnnounce(runtime *acpRuntime, open func() (acp.SessionOpen, error)) (acp.SessionOpen, error) {
	opened, err := withBinding(runtime, open)
	if err != nil {
		return acp.SessionOpen{}, err
	}
	workspace.WriteSessionID(opened.SessionID)
	h.absorbSessionOptions(opened)
	h.mu.Lock()
	empty := len(h.catalog.Models) == 0
	h.mu.Unlock()
	if empty {
		time.Sleep(1200 * time.Millisecond)
		h.applyFallbackModels()
	}
	h.applyPendingModel(runtime)
	h.send(map[string]any{
		"type":      "session",
		"sessionId": opened.SessionID,
		"replay":    opened.Replay,
		"created":   opened.Created,
		"forked":    opened.Forked,
	})
	h.sendModels()
	return opened, nil
}

func (h *Host) applyPendingModel(runtime *acpRuntime) {
	h.mu.Lock()
	pending := h.pendingModelID
	h.mu.Unlock()
	if pending == "" || models.IsUnsetModel(pending) || runtime.client.GetSessionID() == "" || runtime.prompting {
		return
	}
	if err := h.applyModel(runtime, pending); err != nil {
		log.Log("apply model skipped: " + err.Error())
	}
}

func (h *Host) applyModel(runtime *acpRuntime, modelID string) error {
	if models.IsUnsetModel(modelID) {
		h.mu.Lock()
		h.catalog.CurrentID = modelID
		h.mu.Unlock()
		return nil
	}
	h.mu.Lock()
	configID := h.catalog.ModelConfigID
	h.mu.Unlock()
	result, err := runtime.client.SetModel(modelID, configID)
	if err != nil {
		return err
	}
	var options []models.ConfigOption
	if obj, ok := result.(map[string]any); ok {
		options = models.OptionsFromAny(obj["configOptions"])
	}
	overlay := models.CatalogFromConfigOptions(options)
	overlay.CurrentID = modelID
	h.mu.Lock()
	h.catalog = models.MergeCatalog(h.catalog, overlay)
	h.mu.Unlock()
	return nil
}

func (h *Host) replyClient(id int) *acp.Client {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c := h.rpcClients[id]; c != nil {
		return c
	}
	if len(h.runtimes) > 0 {
		return h.runtimes[0].client
	}
	return nil
}

func (h *Host) handleExt(msg map[string]any) {
	typ := str(msg["type"])
	defer func() {
		if rec := recover(); rec != nil {
			log.Log(fmt.Sprintf("handle ext panic: %v", rec))
			h.setHostState("error", fmt.Sprint(rec))
		}
	}()
	if err := h.dispatch(typ, msg); err != nil {
		log.Log("handle ext error: " + hostErrorText(err))
		if typ == "prompt" {
			h.send(map[string]any{"type": "turn.end", "stopReason": "error", "sessionId": str(msg["sessionId"])})
			return
		}
		h.setHostState("error", hostErrorText(err))
	}
}

func (h *Host) dispatch(typ string, msg map[string]any) error {
	switch typ {
	case "hello":
		h.sendHello()
		h.mu.Lock()
		state := h.hostState
		n := len(h.lastAgents)
		h.mu.Unlock()
		if n > 0 {
			h.sendAgents()
		}
		if state != "" && state != "starting" {
			h.send(map[string]any{"type": "status", "state": state})
		}
		return nil
	case "agents.detect":
		return h.scanAgents()
	case "agent.connect":
		return h.connectAgent(str(msg["providerId"]), protocol.AgentPolicy(str(msg["policy"])))
	case "agent.setPolicy":
		policy := protocol.AgentPolicy(str(msg["policy"]))
		h.mu.Lock()
		h.currentPolicy = policy
		runtimes := append([]*acpRuntime{}, h.runtimes...)
		h.mu.Unlock()
		for _, runtime := range runtimes {
			runtime.client.SetPolicy(policy)
		}
		return nil
	case "page.update":
		var page protocol.CurrentPage
		if raw, err := json.Marshal(msg["page"]); err == nil {
			_ = json.Unmarshal(raw, &page)
		}
		workspace.WriteCurrentPage(page)
		h.send(map[string]any{"type": "page", "page": page})
		return nil
	case "tabs.update":
		var snapshot protocol.TabsSnapshot
		if raw, err := json.Marshal(msg["snapshot"]); err == nil {
			_ = json.Unmarshal(raw, &snapshot)
		}
		workspace.WriteTabsSnapshot(snapshot)
		return nil
	case "browser.result":
		var result protocol.BrowserResult
		if raw, err := json.Marshal(msg["result"]); err == nil {
			_ = json.Unmarshal(raw, &result)
		}
		return watch.WriteCommandResult(result)
	case "session.new":
		h.mu.Lock()
		ready := len(h.runtimes) > 0
		h.mu.Unlock()
		if !ready {
			return errors.New("agent is not ready")
		}
		return h.enqueueSessionOp(func() error {
			runtime, err := h.acquireRuntime("")
			if err != nil {
				return err
			}
			_, err = h.openAndAnnounce(runtime, runtime.client.CreateSession)
			return err
		})
	case "session.use":
		h.mu.Lock()
		ready := len(h.runtimes) > 0
		h.mu.Unlock()
		if !ready {
			return errors.New("agent is not ready")
		}
		sessionID := str(msg["sessionId"])
		return h.enqueueSessionOp(func() error {
			if running := h.runtimeBySession(sessionID); running != nil && running.prompting {
				h.send(map[string]any{"type": "session", "sessionId": sessionID, "replay": true})
				return nil
			}
			runtime, err := h.acquireRuntime(sessionID)
			if err != nil {
				return err
			}
			_, err = h.openAndAnnounce(runtime, func() (acp.SessionOpen, error) {
				return runtime.client.UseSession(sessionID)
			})
			return err
		})
	case "session.fork":
		h.mu.Lock()
		ready := len(h.runtimes) > 0
		h.mu.Unlock()
		if !ready {
			return errors.New("agent is not ready")
		}
		sessionID := str(msg["sessionId"])
		return h.enqueueSessionOp(func() error {
			runtime, err := h.acquireRuntime("")
			if err != nil {
				return err
			}
			_, err = h.openAndAnnounce(runtime, func() (acp.SessionOpen, error) {
				return runtime.client.ForkSession(sessionID)
			})
			return err
		})
	case "fs.pick":
		requestID := str(msg["requestId"])
		mode := pick.ParseMode(str(msg["mode"]))
		log.Log("opening file picker")
		items, cancelled, err := pick.LocalPaths(mode)
		if err != nil {
			h.send(map[string]any{"type": "fs.picked", "requestId": requestID, "items": []any{}, "error": err.Error()})
			return nil
		}
		if items == nil {
			items = []protocol.AttachmentItem{}
		}
		out := map[string]any{"type": "fs.picked", "requestId": requestID, "items": items}
		if cancelled {
			out["cancelled"] = true
		}
		h.send(out)
		return nil
	case "fs.reveal":
		path := str(msg["path"])
		if err := reveal.Path(path); err != nil {
			log.Log("fs.reveal: " + err.Error())
		}
		return nil
	case "fs.save":
		requestID := str(msg["requestId"])
		item, err := workspace.SavePastedJPEG(str(msg["imageBase64"]), str(msg["name"]))
		if err != nil {
			h.send(map[string]any{"type": "fs.saved", "requestId": requestID, "items": []any{}, "error": err.Error()})
			return nil
		}
		log.Log("saved paste " + item.Path)
		h.send(map[string]any{"type": "fs.saved", "requestId": requestID, "items": []protocol.AttachmentItem{item}})
		return nil
	case "model.set":
		modelID := str(msg["modelId"])
		sessionID := str(msg["sessionId"])
		h.mu.Lock()
		h.pendingModelID = modelID
		h.catalog.CurrentID = modelID
		h.mu.Unlock()
		runtime := h.runtimeBySession(sessionID)
		if runtime == nil {
			h.mu.Lock()
			for _, item := range h.runtimes {
				if !item.prompting && item.client.GetSessionID() != "" {
					runtime = item
					break
				}
			}
			h.mu.Unlock()
		}
		if runtime == nil || runtime.client.GetSessionID() == "" || models.IsUnsetModel(modelID) || runtime.prompting {
			h.sendModels()
			return nil
		}
		if sessionID != "" && runtime.client.GetSessionID() != sessionID {
			_, _ = withBinding(runtime, func() (acp.SessionOpen, error) {
				return runtime.client.UseSession(sessionID)
			})
		}
		if err := h.applyModel(runtime, modelID); err != nil {
			log.Log("apply model skipped: " + err.Error())
		}
		h.sendModels()
		return nil
	case "prompt":
		return h.handlePrompt(msg)
	case "cancel":
		sessionID := str(msg["sessionId"])
		runtime := h.runtimeBySession(sessionID)
		if runtime == nil {
			h.mu.Lock()
			for _, item := range h.runtimes {
				if item.prompting {
					runtime = item
					break
				}
			}
			h.mu.Unlock()
		}
		if runtime != nil {
			runtime.client.Cancel()
		}
		return nil
	case "permission.reply":
		id := intFrom(msg["id"])
		if c := h.replyClient(id); c != nil {
			c.Respond(id, map[string]any{"outcome": msg["outcome"]})
		}
		h.mu.Lock()
		delete(h.rpcClients, id)
		h.mu.Unlock()
		return nil
	case "cursor.reply":
		id := intFrom(msg["id"])
		if c := h.replyClient(id); c != nil {
			c.Respond(id, msg["result"])
		}
		h.mu.Lock()
		delete(h.rpcClients, id)
		h.mu.Unlock()
		return nil
	default:
		return nil
	}
}

func (h *Host) handlePrompt(msg map[string]any) error {
	h.mu.Lock()
	ready := len(h.runtimes) > 0
	h.mu.Unlock()
	if !ready {
		return errors.New("agent is not ready")
	}
	sessionID := str(msg["sessionId"])
	var runtime *acpRuntime
	err := h.enqueueSessionOp(func() error {
		if sessionID != "" {
			owned := h.runtimeBySession(sessionID)
			if owned != nil && owned.prompting {
				log.Log("prompt ignored, session already running " + sessionID)
				return nil
			}
			next := owned
			if next == nil {
				var e error
				next, e = h.acquireRuntime(sessionID)
				if e != nil {
					return e
				}
			}
			if next.client.GetSessionID() != sessionID {
				opened, e := withBinding(next, func() (acp.SessionOpen, error) {
					return next.client.UseSession(sessionID)
				})
				if e != nil {
					return e
				}
				workspace.WriteSessionID(opened.SessionID)
				if opened.Created {
					h.send(map[string]any{
						"type":      "session",
						"sessionId": opened.SessionID,
						"replay":    opened.Replay,
						"created":   opened.Created,
						"forked":    opened.Forked,
					})
				}
			}
			next.prompting = true
			runtime = next
			return nil
		}
		next, e := h.acquireRuntime("")
		if e != nil {
			return e
		}
		opened, e := withBinding(next, next.client.CreateSession)
		if e != nil {
			return e
		}
		workspace.WriteSessionID(opened.SessionID)
		h.absorbSessionOptions(opened)
		h.send(map[string]any{
			"type":      "session",
			"sessionId": opened.SessionID,
			"replay":    opened.Replay,
			"created":   opened.Created,
			"forked":    opened.Forked,
		})
		h.sendModels()
		next.prompting = true
		runtime = next
		return nil
	})
	if err != nil {
		return err
	}
	if runtime == nil {
		return nil
	}
	prefix := ""
	if page, ok := msg["currentPage"].(map[string]any); ok {
		title := str(page["title"])
		url := str(page["url"])
		if title != "" || url != "" {
			prefix = "[Current tab] " + title + " — " + url + "\n\n"
		}
	}
	defer func() { runtime.prompting = false }()
	stop, err := runtime.client.Prompt(prefix + str(msg["text"]))
	if err != nil {
		return err
	}
	h.send(map[string]any{"type": "turn.end", "stopReason": stop, "sessionId": runtime.client.GetSessionID()})
	return nil
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func intFrom(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return 0
	}
}
