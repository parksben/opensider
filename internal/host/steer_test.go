package host

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/parksben/opensider/internal/acp"
)

// TestTrySteerSendsHermesSlashCommand locks the Host-side framing: a steering
// message must be a second session/prompt carrying `/steer <text>`, and it must
// not look like a new turn to the runtime.
func TestTrySteerSendsHermesSlashCommand(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 is not available")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "fake-acp.py")
	if err := os.WriteFile(script, []byte(fakeSteerAgent), 0o755); err != nil {
		t.Fatal(err)
	}
	trace := filepath.Join(dir, "trace.jsonl")
	client := acp.New(acp.Launch{
		Command: python,
		Args:    []string{script},
		Env:     map[string]string{"FAKE_ACP_TRACE": trace},
	}, acp.Handlers{})
	if err := client.Start(); err != nil {
		t.Fatal(err)
	}
	defer client.Stop()
	if err := client.Initialize(); err != nil {
		t.Fatal(err)
	}
	opened, err := client.CreateSession()
	if err != nil {
		t.Fatal(err)
	}
	runtime := &acpRuntime{client: client, prompting: true, steer: true}
	h := &Host{runtimes: []*acpRuntime{runtime}}
	handled := h.trySteer(map[string]any{
		"steer":     true,
		"sessionId": opened.SessionID,
		"requestId": "steer-1",
		"text":      "please use the simpler fix",
	})
	if !handled {
		t.Fatal("expected the steering message to be handled")
	}
	raw, err := os.ReadFile(trace)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	if len(lines) != 1 || !strings.Contains(lines[0], `"/steer please use the simpler fix"`) {
		t.Fatalf("agent did not receive the Hermes steer prompt: %q", raw)
	}
	if !runtime.prompting {
		t.Fatal("steering must not clear the active turn")
	}
}

const fakeSteerAgent = `#!/usr/bin/env python3
import json, os, sys
trace = os.environ.get("FAKE_ACP_TRACE", "")
session = "fake-steer"

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def record(text):
    if trace:
        with open(trace, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"text": text}) + "\n")

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    msg = json.loads(line)
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if mid is None:
        continue
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": 1}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": mid, "result": {"sessionId": session}})
    elif method == "session/prompt":
        text = "\n".join(block.get("text", "") for block in (params.get("prompt") or []))
        record(text)
        send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
    else:
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
`

func TestIsSteerAck(t *testing.T) {
	ack := map[string]any{
		"sessionUpdate": "agent_message_chunk",
		"content":       map[string]any{"type": "text", "text": "⏩ Steer queued for the active turn: fix it"},
	}
	if !isSteerAck(ack) {
		t.Fatal("expected the Hermes steer ack to be filtered")
	}
	normal := map[string]any{
		"sessionUpdate": "agent_message_chunk",
		"content":       map[string]any{"type": "text", "text": "Normal answer"},
	}
	if isSteerAck(normal) {
		t.Fatal("normal assistant text must not be filtered")
	}
}
