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
	"github.com/parksben/opensider/internal/preview"
	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/release"
	"github.com/parksben/opensider/internal/reveal"
	"github.com/parksben/opensider/internal/uistate"
	"github.com/parksben/opensider/internal/version"
	"github.com/parksben/opensider/internal/watch"
	"github.com/parksben/opensider/internal/workspace"
)

type acpRuntime struct {
	client    *acp.Client
	prompting bool
	binding   bool

	// turnDone 在那一轮 prompt 返回时被关闭（每开始一轮换一个新的）。
	// 「立即发送」靠它知道旧一轮真的收尾了，而不是去等侧栏永远可能等不到的 turn.end。
	turnDone chan struct{}
	// interrupted 标记「这一轮是被立即发送顶掉的」，turn.end 要带上去让侧栏区分处理。
	interrupted bool
}

// interruptWait 是「立即发送」等旧一轮收尾的上限：等不到也照样往下走，
// 否则一个不响应 session/cancel 的 Agent 会把新消息永远卡住。
const interruptWait = 15 * time.Second

var errConnectCancelled = errors.New("connect cancelled")

type Host struct {
	io                 *native.IO
	mu                 sync.Mutex
	bindMu             sync.Mutex
	runtimes           []*acpRuntime
	rpcClients         map[int]*acp.Client
	catalog            models.Catalog
	pendingModelID     string
	currentAgent       *detect.ResolvedAgent
	previousAgent      *detect.ResolvedAgent
	connectingClient   *acp.Client
	connectSeq         int
	currentPolicy      protocol.AgentPolicy
	lastAgents         []protocol.AgentInfo
	hostState          string
	pageCommandTimers  map[string]*time.Timer
	pageCommandSettled map[string]bool
	// stateUpload 是扩展正在分片上传的镜像状态（超过 Native Messaging 单帧上限时走
	// 分片，见 uistate_wire.go）；单帧形态不经过它。由 h.mu 保护。
	stateUpload *uiStateUpload
}

func Run() {
	log.Log("go host starting")
	workspace.Ensure()
	h := &Host{
		rpcClients:         map[int]*acp.Client{},
		currentPolicy:      protocol.PolicyAsk,
		hostState:          "starting",
		catalog:            models.Catalog{ModelConfigID: "model"},
		pageCommandTimers:  map[string]*time.Timer{},
		pageCommandSettled: map[string]bool{},
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
	go h.checkRelease(false)
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

func (h *Host) previewImage(requestID, path string) {
	mime, data, err := preview.Read(path)
	if err != nil {
		log.Log("fs.preview: " + err.Error())
		h.send(map[string]any{"type": "fs.previewed", "requestId": requestID, "error": err.Error()})
		return
	}
	chunks := preview.EncodeChunks(data)
	if len(chunks) == 0 {
		h.send(map[string]any{"type": "fs.previewed", "requestId": requestID, "error": preview.ErrEmptyFile.Error()})
		return
	}
	log.Log(fmt.Sprintf("fs.preview chunks=%d bytes=%d mime=%s", len(chunks), len(data), mime))
	for i, chunk := range chunks {
		h.send(map[string]any{
			"type":      "fs.previewed",
			"requestId": requestID,
			"mime":      mime,
			"size":      len(data),
			"index":     i,
			"total":     len(chunks),
			"data":      chunk,
		})
	}
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
		"version":   version.Display(),
	}
	if providerID != "" {
		msg["providerId"] = providerID
	}
	h.send(msg)
	h.sendUIState()
}

// checkRelease 在后台查 GitHub 上最新 Release 的 tag（缓存 1h）并推给侧栏；侧栏
// 拿它和本地版本比，决定要不要提示用户去更新（更新动作由用户自己的 AI Agent 按
// 仓库里的 skill 执行，见 docs/TECH_DESIGN.md）。`release.check` 会强制重查一次。
//
// 失败降级顺序：新鲜缓存 → 在线查询（API，退网页重定向）→ 陈旧缓存（标 stale，让
// 面板手点检查如实报失败）。失败只记日志：版本检查不该打扰用户，也不该挡住任何功能。
func (h *Host) checkRelease(force bool) {
	if !force {
		if info, ok := release.Cached(); ok {
			h.sendRelease(info, false)
			return
		}
	}
	info, err := release.Latest(6 * time.Second)
	if err != nil {
		log.Log("release check failed: " + err.Error())
		if cached, ok := release.CachedAny(); ok {
			h.sendRelease(cached, true)
		}
		return
	}
	log.Log("release latest=" + info.Tag)
	h.sendRelease(info, false)
}

func (h *Host) sendRelease(info release.Info, stale bool) {
	msg := map[string]any{
		"type":      "release",
		"version":   version.Display(),
		"latest":    info.Tag,
		"checkedAt": info.CheckedAt,
	}
	if stale {
		msg["stale"] = true
	}
	h.send(msg)
}

func (h *Host) sendUIState() {
	state, ok := uistate.LoadMap()
	if !ok {
		h.send(map[string]any{"type": "ui.state", "state": nil})
		return
	}
	messages := uiStateMessages(state)
	if len(messages) > 1 {
		log.Log(fmt.Sprintf("ui.state chunked transfer chunks=%d", len(messages)))
	}
	for _, msg := range messages {
		h.send(msg)
	}
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

func stopRuntimeList(runtimes []*acpRuntime) {
	for _, runtime := range runtimes {
		func() {
			defer func() { _ = recover() }()
			runtime.client.Stop()
		}()
	}
}

func (h *Host) beginConnect() int {
	h.mu.Lock()
	h.connectSeq++
	seq := h.connectSeq
	if h.hostState == "ready" && h.currentAgent != nil {
		snapshot := *h.currentAgent
		h.previousAgent = &snapshot
	} else if h.hostState != "connecting" {
		h.previousAgent = nil
	}
	h.hostState = "connecting"
	stale := h.connectingClient
	h.connectingClient = nil
	h.mu.Unlock()
	if stale != nil {
		stale.Stop()
	}
	return seq
}

func (h *Host) connectInvalid(seq int) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return seq != h.connectSeq
}

func (h *Host) abortConnect(seq int, runtime *acpRuntime, err error) error {
	if runtime != nil && runtime.client != nil {
		runtime.client.Stop()
	}
	h.mu.Lock()
	if runtime != nil && h.connectingClient == runtime.client {
		h.connectingClient = nil
	}
	cancelled := seq != h.connectSeq
	h.mu.Unlock()
	if cancelled || errors.Is(err, errConnectCancelled) {
		return errConnectCancelled
	}
	return err
}

func (h *Host) cancelConnect() error {
	h.mu.Lock()
	if h.hostState != "connecting" {
		h.mu.Unlock()
		return nil
	}
	h.connectSeq++
	client := h.connectingClient
	h.connectingClient = nil
	prev := h.previousAgent
	hasPrev := len(h.runtimes) > 0
	h.mu.Unlock()

	if client != nil {
		client.Stop()
	}

	if hasPrev {
		h.mu.Lock()
		if prev != nil {
			h.currentAgent = prev
		}
		h.mu.Unlock()
		h.sendHello()
		h.sendModels()
		h.sendAgents()
		h.setHostState("ready", "")
		log.Log("connect cancelled; restored previous agent")
		return nil
	}

	h.mu.Lock()
	h.currentAgent = nil
	h.previousAgent = nil
	h.mu.Unlock()
	h.setHostState("idle", "")
	log.Log("connect cancelled; idle")
	return nil
}

func (h *Host) connectAgent(providerID string, policy protocol.AgentPolicy) error {
	seq := h.beginConnect()
	if policy != "" {
		h.mu.Lock()
		h.currentPolicy = policy
		h.mu.Unlock()
	}
	h.setHostState("connecting", "")
	h.sendProgress(1, 6, "resolve", "Resolving CLI")
	resolved := detect.CachedResolved(providerID)
	if resolved == nil {
		resolved = detect.ResolveProfile(providerID)
	}
	if resolved == nil {
		return fmt.Errorf("Could not find an ACP CLI for %s.", providerID)
	}
	if h.connectInvalid(seq) {
		return errConnectCancelled
	}
	h.mu.Lock()
	h.currentAgent = resolved
	h.mu.Unlock()
	detect.RememberResolved(*resolved)

	h.sendProgress(2, 6, "spawn", "Starting process")
	h.mu.Lock()
	h.catalog = models.Catalog{ModelConfigID: "model"}
	h.mu.Unlock()
	runtime := &acpRuntime{}
	if err := h.attachClient(runtime); err != nil {
		return h.abortConnect(seq, runtime, err)
	}
	if err := runtime.client.Start(); err != nil {
		return h.abortConnect(seq, runtime, err)
	}
	if h.connectInvalid(seq) {
		return h.abortConnect(seq, runtime, errConnectCancelled)
	}
	h.mu.Lock()
	h.connectingClient = runtime.client
	h.mu.Unlock()

	h.sendProgress(3, 6, "handshake", "ACP handshake")
	h.sendProgress(4, 6, "auth", "Signing in")
	if err := runtime.client.Initialize(); err != nil {
		return h.abortConnect(seq, runtime, err)
	}
	h.mu.Lock()
	if seq != h.connectSeq {
		h.mu.Unlock()
		return h.abortConnect(seq, runtime, errConnectCancelled)
	}
	old := h.runtimes
	h.runtimes = []*acpRuntime{runtime}
	h.rpcClients = map[int]*acp.Client{}
	h.connectingClient = nil
	h.previousAgent = nil
	count := len(h.runtimes)
	h.mu.Unlock()
	stopRuntimeList(old)
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
	if agent == nil || agent.Profile.ListModels == "" {
		return
	}
	catalog := models.ListCLIModels(agent.Command, agent.Profile.ListModels)
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
	lower := strings.ToLower(text)
	if strings.Contains(lower, "authentication") || (strings.Contains(lower, "api key") && strings.Contains(lower, "invalid")) {
		if strings.Contains(lower, "opencode") || strings.Contains(text, "****") || strings.Contains(lower, "api key") {
			return "OpenCode authentication failed. Run `opencode auth login` in a terminal, then retry."
		}
	}
	return text
}

func (h *Host) enqueueSessionOp(work func() error) error {
	h.bindMu.Lock()
	defer h.bindMu.Unlock()
	return work()
}

// interruptTurn 停下该会话正在跑的那一轮，并等它收尾（上限 interruptWait）。
//
// 「立即发送」靠它保证顺序：先旧一轮结束、再新一轮开始，而不是让侧栏去猜
// turn.end 什么时候来 —— 猜不中，消息就永远发不出去。
func (h *Host) interruptTurn(sessionID string) {
	if sessionID == "" {
		return
	}
	runtime := h.runtimeBySession(sessionID)
	if runtime == nil {
		return
	}
	h.interruptRunning(runtime)
}

// interruptRunning 标记并取消该 runtime 正在跑的那一轮；返回是否真的要求了打断。
// 没在跑就什么都不做：不能把标记挂上去，否则侧栏会把一个普通的 turn.end 当成
// “新一轮已经接上”而不再清 running。
func (h *Host) interruptRunning(runtime *acpRuntime) bool {
	h.mu.Lock()
	prompting := runtime.prompting
	done := runtime.turnDone
	if prompting {
		runtime.interrupted = true
	}
	h.mu.Unlock()
	if !prompting {
		return false
	}
	log.Log("prompt interrupt requested " + runtime.client.GetSessionID())
	runtime.client.Cancel()
	waitTurnDone(done, interruptWait)
	return true
}

// endPrompt 收尾一轮：清 prompting、取出并复位 interrupted、把 turnDone 交出去关闭。
func (h *Host) endPrompt(runtime *acpRuntime) (bool, chan struct{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	runtime.prompting = false
	interrupted := runtime.interrupted
	runtime.interrupted = false
	done := runtime.turnDone
	runtime.turnDone = nil
	return interrupted, done
}

// waitTurnDone 等这一轮结束（channel 关闭），最多 timeout；返回是否等到了。
func waitTurnDone(done <-chan struct{}, timeout time.Duration) bool {
	if done == nil {
		return false
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-done:
		return true
	case <-timer.C:
		log.Log("prompt interrupt timed out waiting for the running turn to end")
		return false
	}
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

func (h *Host) openAndAnnounce(runtime *acpRuntime, requestID string, open func() (acp.SessionOpen, error)) (acp.SessionOpen, error) {
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
		h.refreshModels()
		h.applyFallbackModels()
	}
	h.applyPendingModel(runtime)
	h.send(sessionMessage(opened, requestID))
	h.sendModels()
	return opened, nil
}

// sessionMessage 是 Host → 侧栏的会话回执。requestID 仅在响应侧栏主动请求
// （session.new / session.use / session.fork / prompt）时带上；侧栏只认
// requestId 精确配对的回执，无 requestId 的自发消息不会改动本地绑定。
func sessionMessage(opened acp.SessionOpen, requestID string) map[string]any {
	msg := map[string]any{
		"type":      "session",
		"sessionId": opened.SessionID,
		"replay":    opened.Replay,
		"created":   opened.Created,
		"forked":    opened.Forked,
	}
	if requestID != "" {
		msg["requestId"] = requestID
	}
	return msg
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
		if errors.Is(err, errConnectCancelled) {
			log.Log("connect cancelled")
			return
		}
		log.Log("handle ext error: " + hostErrorText(err))
		if typ == "prompt" {
			h.send(map[string]any{"type": "turn.end", "stopReason": "error", "sessionId": str(msg["sessionId"]), "error": hostErrorText(err)})
			return
		}
		h.setHostState("error", hostErrorText(err))
	}
}

func (h *Host) dispatch(typ string, msg map[string]any) error {
	switch typ {
	case "ui.state.set":
		h.acceptStateSet(msg)
		return nil
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
		if state == "ready" {
			h.sendModels()
		}
		return nil
	case "agents.detect":
		return h.scanAgents()
	case "release.check":
		go h.checkRelease(true)
		return nil
	case "agent.connect":
		return h.connectAgent(str(msg["providerId"]), protocol.AgentPolicy(str(msg["policy"])))
	case "agent.cancelConnect":
		return h.cancelConnect()
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
		h.settlePageCommand(result.ID)
		return watch.WriteCommandResult(result)
	case "overlays":
		return h.handleOverlays(msg)
	case "native.ui":
		h.handleNativeUi(msg)
		return nil
	case "session.new":
		h.mu.Lock()
		ready := len(h.runtimes) > 0
		h.mu.Unlock()
		if !ready {
			return errors.New("agent is not ready")
		}
		requestID := str(msg["requestId"])
		return h.enqueueSessionOp(func() error {
			runtime, err := h.acquireRuntime("")
			if err != nil {
				return err
			}
			_, err = h.openAndAnnounce(runtime, requestID, runtime.client.CreateSession)
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
		requestID := str(msg["requestId"])
		return h.enqueueSessionOp(func() error {
			if running := h.runtimeBySession(sessionID); running != nil && running.prompting {
				h.send(map[string]any{"type": "session", "sessionId": sessionID, "replay": true, "requestId": requestID})
				return nil
			}
			runtime, err := h.acquireRuntime(sessionID)
			if err != nil {
				return err
			}
			_, err = h.openAndAnnounce(runtime, requestID, func() (acp.SessionOpen, error) {
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
		requestID := str(msg["requestId"])
		return h.enqueueSessionOp(func() error {
			runtime, err := h.acquireRuntime("")
			if err != nil {
				return err
			}
			_, err = h.openAndAnnounce(runtime, requestID, func() (acp.SessionOpen, error) {
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
			out := map[string]any{"type": "fs.revealed", "path": path, "error": err.Error()}
			if errors.Is(err, reveal.ErrNotFound) {
				out["missing"] = true
			}
			h.send(out)
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
	case "fs.upload":
		requestID := str(msg["requestId"])
		items, err := workspace.SaveUploaded(str(msg["name"]), str(msg["dir"]), str(msg["base64"]))
		if err != nil {
			h.send(map[string]any{"type": "fs.uploaded", "requestId": requestID, "items": []any{}, "error": err.Error()})
			return nil
		}
		log.Log("saved drop " + str(msg["name"]))
		h.send(map[string]any{"type": "fs.uploaded", "requestId": requestID, "items": items})
		return nil
	case "fs.preview":
		requestID := str(msg["requestId"])
		path := str(msg["path"])
		go h.previewImage(requestID, path)
		return nil
	case "model.set":
		modelID := str(msg["modelId"])
		sessionID := str(msg["sessionId"])
		h.mu.Lock()
		h.pendingModelID = modelID
		h.catalog.CurrentID = modelID
		h.mu.Unlock()
		// 只作用于已持有该会话的进程；找不到就只记 pending（下次打开该会话时
		// applyPendingModel 会补上）。不得抢别的空闲进程做 session/load——那会
		// 静默换掉别人会话的绑定，是串戏的源头之一。
		runtime := h.runtimeBySession(sessionID)
		if runtime == nil || runtime.prompting || models.IsUnsetModel(modelID) {
			h.sendModels()
			return nil
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
		if sessionID == "" {
			return nil
		}
		runtime := h.runtimeBySession(sessionID)
		if runtime == nil {
			return nil
		}
		runtime.client.Cancel()
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
		// 扩展比 Host 新是常态（Host 只在用户跑安装 / 更新 skill 时才换）。旧 Host 遇上
		// 不认识的命令若就这么丢掉，用户看到的是「点了 / 拖了没反应」，一点线索都没有。
		// 所以带 requestId 的一律回一条明确的「不支持」，让侧栏立刻报出来并指向更新。
		log.Log("unsupported command: " + typ)
		if reply := unsupportedReply(typ, msg); reply != nil {
			h.send(reply)
		}
		return nil
	}
}

// unsupportedReply 是「本机 Host 不认识这条命令」的回执。没有 requestId 的消息（单向通知）
// 不需要回执，返回 nil。
func unsupportedReply(command string, msg map[string]any) map[string]any {
	requestID := str(msg["requestId"])
	if requestID == "" {
		return nil
	}
	return map[string]any{
		"type":      "host.unsupported",
		"requestId": requestID,
		"command":   command,
		"error":     `this host does not know the command "` + command + `"`,
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
	requestID := str(msg["requestId"])
	// 「立即发送」带上了 interrupt：先把旧一轮停下来并等它真的收尾，再走下面的
	// 绑定 / 开跑流程。顺序必须由 Host 来定 —— 侧栏自己等 turn.end 再发的话，
	// 只要那一轮没能正常返回（cancel 打空、ACP 会话 id 漂了），新消息就永远发不出去。
	if msg["interrupt"] == true {
		h.interruptTurn(sessionID)
	}
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
					// session/load 失败时 UseSession 会退回 session/new，这里回一条带
					// requestId 的会话回执，让侧栏把本地绑定改到新会话上。
					h.send(sessionMessage(opened, requestID))
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
		h.mu.Lock()
		empty := len(h.catalog.Models) == 0
		h.mu.Unlock()
		if empty {
			h.refreshModels()
			h.applyFallbackModels()
		}
		h.send(sessionMessage(opened, ""))
		h.sendModels()
		next.prompting = true
		runtime = next
		return nil
	})
	if err != nil {
		return err
	}
	if runtime == nil {
		// 会话正在跑、而这次也没有要求打断：保持原有的“忽略”语义，不改老行为。
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
	h.mu.Lock()
	runtime.turnDone = make(chan struct{})
	h.mu.Unlock()
	stop, err := runtime.client.Prompt(prefix + str(msg["text"]))
	interrupted, done := h.endPrompt(runtime)
	if done != nil {
		close(done)
	}
	if err != nil {
		if interrupted {
			// 被打断的那一轮报错是预期内的，按 interrupted 收尾，别走 dispatch 的错误
			// 分支：那条分支发出去的 turn.end 不带 interrupted，侧栏会把已经接上的
			// 新一轮当成结束了（正是这次要修的 bug 形态）。
			log.Log("interrupted turn ended with error: " + err.Error())
			h.send(map[string]any{"type": "turn.end", "stopReason": "cancelled", "interrupted": true, "sessionId": runtime.client.GetSessionID()})
			return nil
		}
		return err
	}
	h.send(map[string]any{"type": "turn.end", "stopReason": stop, "interrupted": interrupted, "sessionId": runtime.client.GetSessionID()})
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
