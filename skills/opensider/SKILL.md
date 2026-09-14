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
| **Extension** — unpacked folder | wherever the user wants it (default `<Downloads>/OpenSider`), recorded with `opensider extension-dir` | you download it, **the user clicks "Load unpacked"** |

Chrome gives no API that loads an unpacked extension, so that one click is the
user's job. Everything else is yours.

## Golden rules

1. **Ask which browser the user actually uses** before touching anything — and in the same
   breath ask **where the extension folder should live** (default `<Downloads>/OpenSider`).
   Never guess and never quietly enable everything you find; record their answer with
   `opensider extension-dir <path>` so the update and doctor flows find it again.
2. **One step, one check.** Every stage ends with a verification command. Do not move on
   until it passes, and never report a stage as done without running its check.
3. **Never fake the extension step.** If the user has not clicked "Load unpacked" yet,
   the install is not finished.
4. **Never delete user data on your own.** `~/.opensider` holds session history, page
   snapshots and files the Agent produced. Removing it always needs an explicit yes.
6. **No Agent CLI found? Keep installing anyway.** The bridge and the extension are still
   worth having — they sit ready until a CLI shows up. Say clearly what is missing and how
   to add it (see stage 1 of `install.md`), then continue; do not abort the install and do
   not pretend the setup is complete.
7. **Reply in the user's language** (the prompt may be Chinese). One or two lines per
   step; show raw command output only when something failed.
8. **If you cannot verify something, say so.** "I could not confirm it" beats a guess.

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
2. **Ask** the user which browser to set up, and where the extension folder should go
3. **Bridge**: download, verify, place, register
4. **Extension**: download to that folder, unpack there, open the extensions page, guide the user
5. **Verify** against `~/.opensider/host.log`
   → [`references/verification.md`](./references/verification.md)

When something does not behave as described, work through
[`references/troubleshooting.md`](./references/troubleshooting.md) instead of guessing.

## Step 3 — report like this

Finish with a short summary, not a log:

```
OpenSider is ready.
- Bridge: v0.2.0 at ~/.opensider/runtime/opensider (registered for Chrome)
- Extension: loaded from <the folder the user picked>
- Agents found: claude (adapter installed), copilot
Next: click the OpenSider icon, pick an agent, and log in if it asks.
```

If you stopped early, say exactly where and what the user has to do next.
