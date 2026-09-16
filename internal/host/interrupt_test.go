package host

import (
	"testing"
	"time"

	"github.com/parksben/opensider/internal/acp"
)

// 「立即发送」要等旧一轮真的收尾：channel 关闭就返回。
func TestWaitTurnDoneReturnsWhenTurnEnds(t *testing.T) {
	done := make(chan struct{})
	go func() {
		time.Sleep(20 * time.Millisecond)
		close(done)
	}()
	if !waitTurnDone(done, 2*time.Second) {
		t.Fatal("expected the wait to observe the closed channel")
	}
}

// Agent 不理会 session/cancel 时不能把新消息永远卡住。
func TestWaitTurnDoneTimesOut(t *testing.T) {
	if waitTurnDone(make(chan struct{}), 30*time.Millisecond) {
		t.Fatal("expected a timeout for a channel that never closes")
	}
}

// interrupting 时 runtime.turnDone 可能还没建好（极窄的竞态窗口）。
func TestWaitTurnDoneNilChannel(t *testing.T) {
	if waitTurnDone(nil, 10*time.Millisecond) {
		t.Fatal("expected false for a nil channel")
	}
}

func TestEndPromptResetsTurnState(t *testing.T) {
	h := &Host{}
	done := make(chan struct{})
	runtime := &acpRuntime{prompting: true, interrupted: true, turnDone: done}

	interrupted, got := h.endPrompt(runtime)
	if !interrupted {
		t.Fatal("expected the interrupted flag to be reported once")
	}
	if got != done {
		t.Fatal("expected the turn-done channel to be handed out")
	}
	if runtime.prompting {
		t.Fatal("expected prompting to be cleared")
	}
	if runtime.turnDone != nil || runtime.interrupted {
		t.Fatal("expected the turn state to be reset")
	}

	// 下一轮没被顶掉时不应该再报 interrupted。
	again, again2 := h.endPrompt(runtime)
	if again || again2 != nil {
		t.Fatal("expected a clean second end")
	}
}

// 没在跑的那一轮不该被标记 interrupted（否则侧栏会以为新一轮已经接上了）。
func TestInterruptRunningIdleRuntimeIsNoop(t *testing.T) {
	h := &Host{}
	runtime := &acpRuntime{client: acp.New(acp.Launch{}, acp.Handlers{})}
	if h.interruptRunning(runtime) {
		t.Fatal("expected an idle runtime not to be interrupted")
	}
	if runtime.interrupted {
		t.Fatal("expected an idle runtime to stay untouched")
	}
	h.interruptTurn("")
	h.interruptTurn("does-not-exist")
}

// 正在跑：打上标记、发 cancel，并把这个标记交给 turn.end。
func TestInterruptRunningFlagsPromptingTurn(t *testing.T) {
	h := &Host{}
	// session 为空时 Cancel 是安全的空操作，不需要真的拉起进程。
	runtime := &acpRuntime{client: acp.New(acp.Launch{}, acp.Handlers{}), prompting: true}
	if !h.interruptRunning(runtime) {
		t.Fatal("expected a running turn to be interrupted")
	}
	if !runtime.interrupted {
		t.Fatal("expected the turn to be flagged as interrupted")
	}
	interrupted, done := h.endPrompt(runtime)
	if !interrupted {
		t.Fatal("expected turn.end to carry interrupted=true")
	}
	if done != nil {
		t.Fatal("expected no turn-done channel on a runtime that never set one")
	}
}
