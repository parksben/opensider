package host

import (
	"testing"

	"github.com/parksben/opensider/internal/selection"
)

// 用户要的是「最终的一条正文」：搜索时 Agent 会先说一串过程（"我先去搜一下…"、"我拿到结果了，
// 再去开几个页面"），那些都不该落到结果层里。判据就是工具调用——最后一次调用之后的才是答案。
func TestSelectionRunKeepsOnlyTextAfterTheLastToolCall(t *testing.T) {
	run := &selectionRun{mode: selection.ModeSearch}
	run.append("I'll search the web for this and summarise it. ")
	run.startToolCall()
	run.append("I have hits, let me open a few primary sources. ")
	run.startToolCall()
	run.append("## 張藝謀\n\n他是中國導演，代表作有《活著》。")

	const want = "## 張藝謀\n\n他是中國導演，代表作有《活著》。"
	if got := run.snapshot(); got != want {
		t.Fatalf("snapshot = %q, want %q", got, want)
	}
}

// 工具调用之后一个字都没说（Agent 只调了工具就结束了）：宁可把过程给他看，也别给一个空层。
func TestSelectionRunFallsBackWhenNothingFollowsTheToolCall(t *testing.T) {
	run := &selectionRun{mode: selection.ModeSearch}
	run.append("I'll search the web for this.")
	run.startToolCall()

	if got, want := run.snapshot(), "I'll search the web for this."; got != want {
		t.Fatalf("snapshot = %q, want %q", got, want)
	}
}

// 一次工具都没调（Agent 直接凭能力答，或老实说搜不了）：没有任何判据切分过程与结论，
// 整段就整段（提示词负责让它只给结论）。
func TestSelectionRunSnapshotKeepsEverythingWithoutToolCalls(t *testing.T) {
	run := &selectionRun{mode: selection.ModeSearch}
	run.append("I cannot search the web with my tools.\n\n張藝謀是中國導演。")

	if got, want := run.snapshot(), "I cannot search the web with my tools.\n\n張藝謀是中國導演。"; got != want {
		t.Fatalf("snapshot = %q, want %q", got, want)
	}
}

// 工具调用之后的正文里再夹进一次工具调用（"再开一个页面"）：仍然只留最后一次之后的那段。
func TestSelectionRunTrimsInterleavedNarration(t *testing.T) {
	run := &selectionRun{mode: selection.ModeSearch}
	run.startToolCall()
	run.append("Searching…")
	run.startToolCall()
	run.append("Done: 張藝謀（1950—），中國導演。")

	if got, want := run.snapshot(), "Done: 張藝謀（1950—），中國導演。"; got != want {
		t.Fatalf("snapshot = %q, want %q", got, want)
	}
}
