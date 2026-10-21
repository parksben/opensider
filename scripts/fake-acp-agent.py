#!/usr/bin/env python3
"""Minimal ACP agent for verification runs on machines where Node is instrumented.

The JavaScript fake (`fake-acp-agent.mjs`) is the full-featured one. Some corporate
machines inject a `--require` probe into every Node process (an endpoint agent), which can
block Node before the script runs; this Python twin covers the narrow case used by
`verify-session-recover.mjs`:

  * answers `initialize`
  * `session/new`
  * refuses `session/load` / `session/fork` (to exercise the host's fallback)
  * echoes two chunks and ends a prompt
  * appends one JSON line per event to $FAKE_ACP_TRACE
"""

import json
import os
import sys
import time

trace_path = os.environ.get("FAKE_ACP_TRACE", "")


def trace(entry):
    if not trace_path:
        return
    entry = {"at": int(time.time() * 1000), **entry}
    try:
        with open(trace_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")
    except OSError:
        pass


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


session_id = None
trace({"event": "start", "pid": os.getpid(), "argv": sys.argv[1:]})

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        continue
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if mid is None:
        continue
    if method == "initialize":
        trace({"event": "initialize"})
        send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": 1, "agentCapabilities": {}}})
    elif method == "session/new":
        session_id = f"pysid-{int(time.time() * 1000)}"
        send({"jsonrpc": "2.0", "id": mid, "result": {"sessionId": session_id}})
    elif method in ("session/load", "session/fork"):
        trace({"event": "load_failed", "method": method, "sessionId": params.get("sessionId", "")})
        send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "session/load is not supported"}})
    elif method == "session/prompt":
        text = "\n".join(block.get("text", "") for block in (params.get("prompt") or []))
        target = params.get("sessionId") or session_id or ""
        trace({"event": "prompt", "text": text, "sessionId": target})
        for index in range(2):
            send({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": target,
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": f"pong{index} "},
                    },
                },
            })
        send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
    else:
        send({"jsonrpc": "2.0", "id": mid, "result": {}})
