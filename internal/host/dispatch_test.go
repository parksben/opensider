package host

import "testing"

// 版本错配是这块代码里唯一「静默失败」的入口：扩展比 Host 新时，Host 不认识的新命令
// 以前只回一句 return nil，侧栏的 await 就永远悬着。回执形状必须锁住。
func TestUnsupportedReplyAnswersRequests(t *testing.T) {
	reply := unsupportedReply("fs.upload", map[string]any{"type": "fs.upload", "requestId": "abc"})
	if reply == nil {
		t.Fatal("a request with an id must get an answer")
	}
	if reply["type"] != "host.unsupported" || reply["requestId"] != "abc" || reply["command"] != "fs.upload" {
		t.Fatalf("unexpected reply: %v", reply)
	}
	if reply["error"] == "" {
		t.Fatal("the reply should say what went wrong")
	}
}

func TestUnsupportedReplyStaysSilentWithoutRequestID(t *testing.T) {
	if reply := unsupportedReply("ui.state.set", map[string]any{"type": "ui.state.set"}); reply != nil {
		t.Fatalf("one-way messages need no answer, got %v", reply)
	}
}
