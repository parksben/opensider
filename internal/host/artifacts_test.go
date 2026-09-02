package host

import (
	"testing"
	"time"

	"github.com/parksben/opensider/internal/protocol"
)

func TestSettlePageCommandOnlyOnce(t *testing.T) {
	h := &Host{
		pageCommandTimers:  map[string]*time.Timer{},
		pageCommandSettled: map[string]bool{},
	}
	if !h.settlePageCommand("cmd_1") {
		t.Fatal("first settle should succeed")
	}
	if h.settlePageCommand("cmd_1") {
		t.Fatal("duplicate settle should be ignored")
	}
}

func TestArmPageCommandTimeoutCanSettle(t *testing.T) {
	h := &Host{
		pageCommandTimers:  map[string]*time.Timer{},
		pageCommandSettled: map[string]bool{},
	}
	h.armPageCommandTimeout(protocol.BrowserCommand{ID: "cmd_2", Method: "getReadable"})
	if !h.settlePageCommand("cmd_2") {
		t.Fatal("result should settle a pending page command")
	}
	if h.settlePageCommand("cmd_2") {
		t.Fatal("timeout must not settle after a result")
	}
}
