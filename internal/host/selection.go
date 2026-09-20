package host

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/parksben/opensider/internal/log"
	"github.com/parksben/opensider/internal/protocol"
	"github.com/parksben/opensider/internal/selection"
)

// 划词工具条背后的隐藏通道：网页上选中一段文字后点「翻译」或「搜索」，由它去问 Agent。
//
// 三条纪律：
//  1. **不进当前会话**：专用 runtime + **每次请求新开一个 ACP 会话**。进程复用是为了快
//     （不重复起进程），每次新开会话是为了干净（这次划词不会被上次划词影响上下文）。
//  2. **不进侧栏**：它的 `session/update` / `turn.end` 一条都不广播，只把文本推给发起请求
//     的那个标签页。用户看到的对话里不会多出任何东西。
//  3. **不碰用户的页面**：这个 runtime 不 anchor 标签页，扩展那边的浏览器控制闸门因此天然
//     不放行它——它拿不到浏览器（用户要求 v1 就是这样：搜索靠 Agent 自带的检索能力）。
//
// 「固定会话」是这条固定通道，而不是一个会累积上下文的会话（用户原话要的是「不进入当前
// 会话的上下文」，一个长期复用的会话迟早会把上一次划词带进来）。

// selectionTimeout 是单次划词请求的上限：超时就取消，别让一个不响应 cancel 的 Agent 把
// 这条通道占死。
const selectionTimeout = 60 * time.Second

// selectionRun 是一次划词请求（同一个请求的增量都往它身上累积）。
type selectionRun struct {
	requestID string
	tabID     int
	mode      string
	text      string

	mu       sync.Mutex
	runtime  *acpRuntime
	buffer   strings.Builder
	previous string
	toolSeen bool
	cancel   bool
	done     bool
}

func (r *selectionRun) attachRuntime(runtime *acpRuntime) {
	r.mu.Lock()
	r.runtime = runtime
	r.mu.Unlock()
}

func (r *selectionRun) runtimeRef() *acpRuntime {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.runtime
}

// append 收一段增量并返回**累积后**的全文：推给页面的是全文，页面直接替换内容，省掉
// 增量顺序与去重这些容易出错的事情（划词结果本来就很短）。
func (r *selectionRun) append(text string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buffer.WriteString(text)
	return r.buffer.String()
}

func (r *selectionRun) snapshot() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	// 最后一次工具调用之后的正文才是答案；Agent 在那之后一个字都没说（极端情况）才退回
	// 被清掉的那段：宁可给它看过程，也别给它一个空层。
	if strings.TrimSpace(r.buffer.String()) == "" {
		return r.previous
	}
	return r.buffer.String()
}

// startToolCall 收到「工具调用开始」：在这之前累积的正文都是过程叙述（"我先去搜一下…"），
// 结果层要的是最终结论，所以把它挪到 previous 当兜底、清空累积——只留这次调用之后的正文。
func (r *selectionRun) startToolCall() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.toolSeen = true
	if r.buffer.Len() == 0 {
		return
	}
	r.previous = r.buffer.String()
	r.buffer.Reset()
}

// hasTool 报告这次请求里 Agent 是否已经动过工具。
func (r *selectionRun) hasTool() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.toolSeen
}

// cancelTurn 取消这次请求：标记 + 停掉正在跑的那一轮（幂等）。
func (r *selectionRun) cancelTurn() {
	r.mu.Lock()
	already := r.cancel
	r.cancel = true
	runtime := r.runtime
	r.mu.Unlock()
	if already {
		return
	}
	log.Log("selection cancelled " + r.requestID)
	if runtime != nil {
		runtime.client.Cancel()
	}
}

func (r *selectionRun) cancelled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cancel
}

// finish 标记这一轮结束，返回是否是第一次（收尾只做一次）。
func (r *selectionRun) finish() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.done {
		return false
	}
	r.done = true
	return true
}

// runSelection 处理扩展来的 selection.run（翻译 / 搜索）。
//
// 这条命令**不把错误抛给 dispatch**：dispatch 的错误分支会把整个 Host 标成 error，而一次
// 划词失败跟「桥接坏了」完全是两件事。所以这里全部自己收尾，只回一条 selection.failed。
func (h *Host) runSelection(msg map[string]any) {
	requestID := str(msg["requestId"])
	if requestID == "" {
		return // 没有 requestId 就没法回报，等于无效请求
	}
	tabID := intFrom(msg["tabId"])
	mode := str(msg["mode"])
	text := strings.TrimSpace(str(msg["text"]))
	target := str(msg["targetLang"])

	fail := func(reason string) {
		log.Log("selection " + mode + " rejected: " + reason)
		h.sendSelection("selection.failed", requestID, tabID, "", reason)
	}
	if !selection.IsMode(mode) {
		fail("unknown mode " + mode)
		return
	}
	if text == "" {
		fail("empty selection")
		return
	}
	if selection.TooLong(text) {
		// 扩展侧先拦了一道，这里再拦一道：Host 不该相信任何一条消息。
		fail(fmt.Sprintf("selection is longer than %d characters", selection.MaxRunes))
		return
	}

	// 单飞：一次只可能有一个结果层，新请求先取消旧的。
	h.cancelSelection("")

	run := &selectionRun{requestID: requestID, tabID: tabID, mode: mode, text: text}
	h.mu.Lock()
	ready := h.currentAgent != nil && len(h.runtimes) > 0
	h.selection = run
	h.mu.Unlock()
	if !ready {
		h.clearSelection(run)
		fail("agent is not ready")
		return
	}
	log.Log("selection " + mode + " requested")
	go h.runSelectionTurn(run, target)
}

// cancelSelection 取消正在跑的划词请求（requestID 为空表示「不管哪一个」）。
func (h *Host) cancelSelection(requestID string) {
	h.mu.Lock()
	run := h.selection
	if run == nil || (requestID != "" && run.requestID != requestID) {
		h.mu.Unlock()
		return
	}
	h.selection = nil
	h.mu.Unlock()
	run.cancelTurn()
}

func (h *Host) clearSelection(run *selectionRun) {
	h.mu.Lock()
	if h.selection == run {
		h.selection = nil
	}
	h.mu.Unlock()
}

func (h *Host) runSelectionTurn(run *selectionRun, target string) {
	defer h.clearSelection(run)

	runtime, err := h.utilityRuntime()
	if err != nil {
		h.sendSelection("selection.failed", run.requestID, run.tabID, "", err.Error())
		return
	}
	// 每次请求新开一个 ACP 会话：上下文干净，也不会把上一次划词带进来。
	opened, err := withBinding(runtime, runtime.client.CreateSession)
	if err != nil {
		h.dropUtilityRuntime(runtime, "session/new failed: "+err.Error())
		h.sendSelection("selection.failed", run.requestID, run.tabID, "", err.Error())
		return
	}
	run.attachRuntime(runtime)
	runtime.selection = run

	timeout := time.AfterFunc(selectionTimeout, func() {
		log.Log("selection timed out")
		run.cancelTurn()
	})
	stop, err := runtime.client.Prompt(selection.PromptFor(run.mode, run.text, selection.LanguageName(target)))
	timeout.Stop()

	runtime.selection = nil
	// ACP 会话用完即弃（下次请求重新 session/new），这里只记一笔便于排查。
	log.Log("utility session " + opened.SessionID + " finished")

	if err != nil {
		if !run.cancelled() {
			h.sendSelection("selection.failed", run.requestID, run.tabID, "", err.Error())
		}
		return
	}
	if stop != "" && stop != "end_turn" {
		log.Log("selection " + run.mode + " stop=" + stop)
	}
	if run.cancelled() {
		return
	}
	text := run.snapshot()
	if strings.TrimSpace(text) == "" {
		h.sendSelection("selection.failed", run.requestID, run.tabID, "", "the agent returned nothing")
		return
	}
	h.sendSelection("selection.done", run.requestID, run.tabID, text, "")
	log.Log("selection " + run.mode + " done " + fmt.Sprintf("%d chars", len(text)))
}

// absorbSelectionUpdate 收隐藏通道的流式文本。工具调用之类的更新直接丢掉：结果层只渲染
// 助手正文，中间过程对用户没有意义（也不该出现在页面里）。
func (h *Host) absorbSelectionUpdate(runtime *acpRuntime, update map[string]any) {
	run := runtime.selection
	if run == nil {
		return // 上一轮取消后迟到的增量：丢掉
	}
	switch str(update["sessionUpdate"]) {
	case "tool_call":
		// 工具调用开始：前面那些「我准备搜索一下…」的过程叙述作废（见 startToolCall）。
		run.startToolCall()
		return
	case "agent_message_chunk":
	default:
		return
	}
	content, ok := update["content"].(map[string]any)
	if !ok {
		return
	}
	// 这里**不能**用 str()：它会 TrimSpace，流式文本里的空格与换行都是内容。
	chunk, _ := content["text"].(string)
	if chunk == "" {
		return
	}
	// 搜索：还没动过工具时说的话全是过程叙述（"我先去搜一下"），一个字都不推给页面——
	// 结果层这时就该停在「搜索中」，等它真的拿到东西再说。翻译没工具可调，照常逐字推。
	if run.mode == selection.ModeSearch && !run.hasTool() {
		run.append(chunk)
		return
	}
	full := run.append(chunk)
	if run.cancelled() {
		return
	}
	h.sendSelection("selection.delta", run.requestID, run.tabID, full, "")
}

// utilityRuntime 取（或懒建）隐藏通道的 runtime。按 `utility` 标记在现有列表里找，而不是
// 单独存一个指针：换 Agent 时旧进程会被停掉并从列表里消失，扫描天然自愈。
func (h *Host) utilityRuntime() (*acpRuntime, error) {
	h.mu.Lock()
	if h.currentAgent == nil {
		h.mu.Unlock()
		return nil, errors.New("agent is not ready")
	}
	for _, runtime := range h.runtimes {
		if runtime.utility && runtime.client != nil && runtime.client.GetSessionID() != "" {
			h.mu.Unlock()
			return runtime, nil
		}
	}
	// 有进程但没会话（上一次 session/new 失败过）也复用，省一次启动。
	for _, runtime := range h.runtimes {
		if runtime.utility && runtime.client != nil {
			h.mu.Unlock()
			return runtime, nil
		}
	}
	agent := h.currentAgent
	h.mu.Unlock()

	runtime := &acpRuntime{utility: true}
	if err := h.attachClient(runtime); err != nil {
		return nil, err
	}
	if err := runtime.client.Start(); err != nil {
		runtime.client.Stop()
		return nil, err
	}
	if err := runtime.client.Initialize(); err != nil {
		runtime.client.Stop()
		return nil, err
	}
	h.mu.Lock()
	// 取用期间已经换过 Agent 就丢掉这次的结果，别把旧引擎的进程挂到新 Agent 上。
	if h.currentAgent != agent {
		h.mu.Unlock()
		runtime.client.Stop()
		return nil, errors.New("agent changed while opening the utility channel")
	}
	h.runtimes = append(h.runtimes, runtime)
	h.mu.Unlock()
	log.Log("utility runtime ready")
	return runtime, nil
}

// dropUtilityRuntime 停掉一个坏掉的隐藏通道进程（会话建不起来 / 进程已死时），下次请求会
// 重新建。留着它只会让后面每一次划词都失败。
func (h *Host) dropUtilityRuntime(runtime *acpRuntime, reason string) {
	h.mu.Lock()
	kept := h.runtimes[:0:0]
	for _, item := range h.runtimes {
		if item != runtime {
			kept = append(kept, item)
		}
	}
	h.runtimes = kept
	h.mu.Unlock()
	log.Log("utility runtime dropped: " + reason)
	stopRuntimeList([]*acpRuntime{runtime})
}

func (h *Host) sendSelection(typ, requestID string, tabID int, text string, errText string) {
	msg := map[string]any{"type": typ, "requestId": requestID, "tabId": tabID}
	if text != "" {
		msg["text"] = text
	}
	if errText != "" {
		msg["error"] = errText
	}
	h.send(msg)
}

// autoAllowOptionID 给隐藏通道挑一个「放行」选项：优先 always / unrestricted，其次
// once / allow / yes；明确拒绝的一律不选，实在挑不出来就**不答**（宁可不回答，也不要
// 假装放行）。
//
// 这是侧栏那份 autoPermissionOptionId（packages/extension/src/sidepanel/persist.ts）的 Go
// 双胞胎：隐藏通道没有侧栏那套拦卡界面，权限卡必须当场答掉，否则这一轮永远卡住。两边口径
// 要保持一致，改一处就得同时改另一处。
func autoAllowOptionID(params map[string]any) string {
	best := ""
	bestScore := -1
	for _, option := range mapSlice(params["options"]) {
		id := str(option["optionId"])
		if id == "" {
			id = str(option["id"])
		}
		if id == "" {
			continue
		}
		text := strings.ToLower(id + " " + str(option["name"]) + " " + str(option["kind"]))
		score := 1
		switch {
		case selectionDenyPattern.MatchString(text):
			score = 0
		case selectionAlwaysPattern.MatchString(text):
			score = 3
		case selectionAllowPattern.MatchString(text):
			score = 2
		}
		if score > bestScore {
			bestScore, best = score, id
		}
	}
	if bestScore <= 0 {
		return ""
	}
	return best
}

var (
	selectionDenyPattern   = regexp.MustCompile(`(reject|deny|cancel|拒绝)`)
	selectionAlwaysPattern = regexp.MustCompile(`(always|unrestricted|始终)`)
	selectionAllowPattern  = regexp.MustCompile(`(once|allow|approve|yes|允许)`)
)

// autoCursorResult 自动应答 Cursor 的交互式提问 / 计划审批，口径与侧栏在 `unattended` 档下
// 一致：提问每题取第一项，计划直接接受。隐藏通道没有界面，不该把这些卡片推给用户。
func autoCursorResult(method string, params map[string]any) (any, bool) {
	switch method {
	case "cursor/ask_question":
		questions := mapSlice(params["questions"])
		answers := make([]any, 0, len(questions))
		for _, question := range questions {
			selected := []any{}
			if options := mapSlice(question["options"]); len(options) > 0 {
				if optionID := str(options[0]["id"]); optionID != "" {
					selected = append(selected, optionID)
				}
			}
			answers = append(answers, map[string]any{
				"questionId":        str(question["id"]),
				"selectedOptionIds": selected,
			})
		}
		return map[string]any{"outcome": map[string]any{"outcome": "answered", "answers": answers}}, true
	case "cursor/create_plan":
		return map[string]any{"outcome": map[string]any{"outcome": "accepted"}}, true
	default:
		return nil, false
	}
}

// mapSlice 把 JSON 解出来的数组收成 map 列表。
func mapSlice(v any) []map[string]any {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if entry, ok := item.(map[string]any); ok {
			out = append(out, entry)
		}
	}
	return out
}

// utilityPolicy 是隐藏通道固定使用的权限档：工具权限一律放行（否则一张无人应答的卡会把
// 这一轮永远卡住）。它只作用于这条通道自己的进程。
const utilityPolicy = protocol.PolicyUnattended
