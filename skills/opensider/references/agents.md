# Supported Agent CLIs, their logins, and the ACP adapters

OpenSider does not bundle an agent. It spawns one of these, reusing the login that is
already on this machine. At least one of them must be installed **and logged in**.

| CLI | Agent id | How OpenSider launches it | Notes |
|---|---|---|---|
| Cursor | `cursor` | `agent acp` | comes with Cursor; `agent login` once |
| GitHub Copilot | `copilot` | `copilot --acp --stdio` | `copilot login` once |
| Claude Code | `claude` | `claude-agent-acp` | **needs an adapter** (below) |
| Codex | `codex` | `codex-acp` | **needs an adapter** (below) |
| OpenCode | `opencode` | `opencode acp` | single binary from opencode.ai |
| Gemini | `gemini` | `gemini --experimental-acp` | npm `@google/gemini-cli` |
| Qwen Code | `qwen` | `qwen --acp` | |
| Kimi | `kimi` | `kimi acp` | |
| iFlow | `iflow` | `iflow --experimental-acp` | |
| Trae | `trae` | `traecli acp serve` | |
| Qoder | `qoder` | `qodercli --acp` | |
| CodeBuddy | `codebuddy` | `codebuddy --acp` | |

## Detecting what is installed

```sh
for c in agent cursor-agent copilot opencode gemini qwen kimi iflow traecli qodercli codebuddy claude codex; do
  command -v "$c" >/dev/null 2>&1 && echo "found: $c"
done
```

`command -v` in a bare shell can miss CLIs installed under nvm / fnm / volta / asdf / bun /
`~/.npm-global` / `~/.opencode/bin`. The bridge scans those directories itself, so "not on
this PATH" is not proof that it is missing — say what you found and let the panel's agent
list be the truth.

**If nothing is found at all**, that is not a failed install: finish the bridge and the
extension (they simply wait for a CLI), and tell the user which one to install — the exact
wording, the per-CLI commands and the Node caveat are in stage 1 of
[`../install.md`](../install.md). Do not stop before the extension is loaded, and do not
call the setup complete either.

## ACP adapters (Claude Code and Codex)

The official interactive `claude` and `codex` binaries do not speak ACP. Each has an
official adapter package:

| CLI | Package | Installed to |
|---|---|---|
| Claude Code | `@agentclientprotocol/claude-agent-acp` | `~/.opensider/runtime/claude-acp` |
| Codex | `@agentclientprotocol/codex-acp` | `~/.opensider/runtime/codex-acp` |

`opensider install` handles this automatically: if the CLI is present and the adapter is
not, it installs the adapter into OpenSider's own runtime folder (no `sudo`, no global npm
package). It needs **Node 18+ with npm, pnpm or bun** on PATH; without one it prints a
note and continues — the bridge still installs, that CLI just will not appear until Node
is available.

Requirements to state to the user, not to work around:

* no Node → tell them to install Node 18+ (or use a CLI that needs no adapter)
* adapter present but the CLI is not → nothing to do; install the CLI first
* after an adapter install, the CLI shows up on the next connect

## After install: the user still has to log in

OpenSider reuses the CLI's own login. If the panel connects but the first prompt fails,
the usual cause is "not logged in" rather than anything about the bridge — have the user
run the CLI's login once in a terminal (`agent login`, `copilot login`, or just start the
CLI interactively).

Some CLIs write config into their own folders (`~/.gemini`, `~/.codex`, `~/.claude`). If
one of those is owned by root (a past `sudo` install), the CLI fails with `EACCES`; fix
ownership with `sudo chown -R "$(whoami)" ~/.gemini` and say why.
