package host

import (
	"errors"
	"testing"
)

func TestHostErrorTextOpenCodeAuth(t *testing.T) {
	got := hostErrorText(errors.New(`{"code":-32603,"message":"Internal error: Authentication Fails, Your api key: ****5000 is invalid"}`))
	if got != "OpenCode authentication failed. Run `opencode auth login` in a terminal, then retry." {
		t.Fatalf("got %q", got)
	}
}

func TestHostErrorTextPassthrough(t *testing.T) {
	err := errors.New("agent process exited")
	if hostErrorText(err) != err.Error() {
		t.Fatal(hostErrorText(err))
	}
}
