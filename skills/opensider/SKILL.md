---
name: opensider
description: Install, update, repair or uninstall the OpenSider browser bridge and its side panel extension on this machine. Use when the user pastes an OpenSider request (for example "帮我安装 OpenSider 插件" or "install OpenSider"), when the OpenSider side panel says the local bridge is missing, or when the user asks to update / repair / remove OpenSider.
---

# OpenSider setup skill

OpenSider is a Chromium side panel extension that drives a local ACP Agent CLI
(Cursor, GitHub Copilot, Claude Code, Codex, OpenCode, Gemini, Qwen, Kimi, iFlow,
Trae, Qoder …). Two pieces have to exist on this machine:

| Piece | Where | Who does it |
|---|---|---|
| **Bridge** — `opensider` binary + Native Messaging manifests | `~/.opensider/runtime/` and every browser's `NativeMessagingHosts/` | you, following this skill |
| **Extension** — unpacked folder | wherever the user picks (`~/OpenSider` suggested), recorded with `opensider extension-dir` | you download it, **the user clicks "Load unpacked"** |

Chrome gives no API that loads an unpacked extension, so that one click is the
user's job. Everything else is yours.

## Golden rules

1. **Confirm the browser with the user — always, even when only one is installed.** Detect
   the Chromium browsers first, then show what you found and ask which one they want this
   set up in. "You only have Chrome, so I used Chrome" is not a confirmation: they have to
   say it. Never guess, never quietly enable everything you find.
2. **Ask where the extension folder goes — and wait for the answer.** This must happen
   *before* you create a folder, download `extension.zip` or record a path. `<Downloads>/OpenSider`
   looks like a sensible default, but "clear my downloads" habits and cleanup tools delete it,
   and a deleted folder breaks the extension until it is loaded again — so put a durable path
   (`~/OpenSider`) on the table, say that trade-off in one line, and record **their** choice
   with `opensider extension-dir <path>`. If they have not named a path, you have not asked
   yet: ask, and stop there. Your own suggestion is not an answer.
3. **Show the plan as a todo list before you start.** Every operation is a handful of stages;
   give the user the list up front (their agent's todo tool if it has one, otherwise a
   checklist in the chat) and mark each stage done as you go, so the progress is visible
   instead of buried in command output.
4. **One step, one check.** Every stage ends with a verification command. Do not move on
   until it passes, and never report a stage as done without running its check.
5. **Never fake the extension step.** If the user has not clicked "Load unpacked" yet,
   the install is not finished.
6. **Never delete user data on your own.** `~/.opensider` holds session history, page
   snapshots and files the Agent produced. Removing it always needs an explicit yes.
7. **No Agent CLI found? Keep installing anyway.** The bridge and the extension are still
   worth having — they sit ready until a CLI shows up. Say clearly what is missing and how
   to add it (see stage 1 of `install.md`), then continue; do not abort the install and do
   not pretend the setup is complete.
8. **Reply in the user's language** (the prompt may be Chinese). One or two lines per
   step; show raw command output only when something failed.
9. **If you cannot verify something, say so.** "I could not confirm it" beats a guess.

## Step 0 — pick the operation

| The user asked for | Read | Then |
|---|---|---|
| install (the default) | [`install.md`](./install.md) | bridge → extension → verify |
| update / "有新版本了" | [`update.md`](./update.md) | compare versions → refresh both → verify |
| remove / uninstall | [`uninstall.md`](./uninstall.md) | unregister bridge → ask about data → guide extension removal |
| "坏了 / 连不上 / not working" | [`doctor.md`](./doctor.md) | read-only checks first, then fix what is fixable |

If the request is ambiguous ("装一下"), run `doctor.md` first: it tells you whether this
is a fresh install, a half-finished one, or a broken one.

## Step 1 — pin one version (do this first, always)

Skill files and release assets must come from the same release. Resolve the latest tag first —
ask the **API**, which is authoritative right after a release:

```sh
tag=$(curl -fsSL https://api.github.com/repos/parksben/opensider/releases/latest \
  | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
# fallback only (the web redirect is cached and can lag behind a fresh release):
[ -n "$tag" ] || tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  https://github.com/parksben/opensider/releases/latest | sed 's#.*/tag/##')
```

Windows (PowerShell):

```powershell
$tag = (Invoke-RestMethod "https://api.github.com/repos/parksben/opensider/releases/latest").tag_name
```

* Fetch the rest of this skill from
  `https://raw.githubusercontent.com/parksben/opensider/$tag/skills/opensider/…`
  (`install.md`, `update.md`, `uninstall.md`, `doctor.md`, `references/*.md`).
* Fetch binaries and `extension.zip` from
  `https://github.com/parksben/opensider/releases/download/$tag/…`.

If no tag can be resolved at all (offline, proxy, GitHub blocked): stop and tell the user you
need network access to GitHub — do not install a version you cannot identify.

Never mix files from different tags, and never install an asset you could not verify.

## Step 2 — work through the stages

Every stage of every operation has the same shape: **act → run the check → only then
continue**. The stages are:

1. **Detect** the platform, the Agent CLIs and what is already on the machine
   → [`references/platforms.md`](./references/platforms.md), [`references/agents.md`](./references/agents.md)
2. **Ask the two blocking questions** — which browser to set this up in, and where the
   extension folder should live. **Stop here until both are answered in the user's own
   words**, then record the folder with `opensider extension-dir <path>`. Nothing is
   created, downloaded or unpacked before that.
3. **Bridge**: download, verify, place, register
4. **Extension**: unpack `extension.zip` into the folder chosen in stage 2, open the
   extensions page, guide the user through "Load unpacked"
5. **Verify** against `~/.opensider/host.log`
   → [`references/verification.md`](./references/verification.md)

These same stages are the todo list from golden rule 3: show it, then tick it off as each
check passes.

When something does not behave as described, work through
[`references/troubleshooting.md`](./references/troubleshooting.md) instead of guessing.

## Step 3 — report like this

Finish with a short summary, not a log:

```
OpenSider is ready.
- Bridge: 0.2.2 at ~/.opensider/runtime/opensider (registered for Chrome)
- Extension: loaded from <the folder the user picked>
- Agents found: claude (adapter installed), copilot
Next: click the OpenSider icon, pick an agent, and log in if it asks.
```

If you stopped early, say exactly where and what the user has to do next.
