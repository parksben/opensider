# Doctor: is this machine set up, and if not, why?

Read-only until the last table. Never delete user data here — no `rm` on `~/.opensider`,
no reinstall before you know which stage is broken.

## Stage 1 — take the three measurements

```sh
bin=~/.opensider/runtime/opensider

# 1. bridge present and runnable?
ls -l "$bin" && "$bin" version

# 2. extension on disk, and which version? (the folder the browser loads)
repo_ext=$("$bin" extension-dir)
grep -o '"version": *"[^"]*"' "$repo_ext/manifest.json" | head -1

# 3. has the bridge ever been launched by a browser?
tail -n 12 ~/.opensider/host.log        # "go host starting" lines, newest last
```

Windows: same three paths under `$env:USERPROFILE\.opensider`, and `Get-Content -Tail 12`
for the log.

Which ones are missing tells you where to go:

| State | Meaning | Go to |
|---|---|---|
| no binary | never installed, or the runtime folder was wiped | [`install.md`](./install.md) |
| binary, no `host.log` line | bridge installed but no browser ever started it — manifest missing, extension not loaded, or nobody opened the panel yet | Stage 2 below |
| binary + old `host.log` line, panel says offline | Chrome cannot reach the manifest, or the host crashed | Stage 3 below |
| everything present, one version old | nothing is broken | [`update.md`](./update.md) |

## Stage 2 — is the bridge registered for the browsers that exist?

```sh
ls ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.opensider.host.json \
   ~/Library/Application\ Support/Microsoft\ Edge/NativeMessagingHosts/com.opensider.host.json 2>/dev/null
```

Per-OS / per-browser locations, including profile folders and the snap / flatpak cases,
are listed in [`references/platforms.md`](./references/platforms.md).

* Manifest missing for a browser the user actually uses → run `opensider install` again
  (it rewrites all of them; it is safe to repeat).
* Manifest present but the `path` inside does not exist → the binary moved; `opensider
  install` rewrites the path.
* macOS: `xattr -p com.apple.quarantine <binary>` still set → clear it
  (`xattr -d com.apple.quarantine`), see `references/troubleshooting.md`.
* Windows: `Get-Item <binary> -Stream Zone.Identifier` exists → `Unblock-File`.

## Stage 3 — can the panel actually connect?

Ask the user to open the side panel and read the state it shows:

| Panel shows | Likely cause | Action |
|---|---|---|
| "send this prompt to your AI Agent" (bridge missing) | manifest for *this* browser/profile is absent | Stage 2 |
| stuck at "starting" | the host launched but the CLI scan is slow or the pipe is dirty | check the newest `host.log` lines; `references/troubleshooting.md` |
| "no ACP CLI found" | no supported CLI installed, or a Claude / Codex adapter is missing | [`references/agents.md`](./references/agents.md) |
| error naming `~/.opensider/host.log` | the host exited; the reason is in the last log lines | `references/troubleshooting.md` |

## Stage 4 — fix, then re-measure

Fix one thing at a time and re-run Stage 1 after each fix. The repairs allowed here are
all non-destructive:

* re-run `~/.opensider/runtime/opensider install`
* re-download and replace the binary (checksum first — `install.md` Stage 3)
* re-unpack `extension.zip` into the extension folder (`opensider extension-dir`) and ask the
  user to click Reload in `chrome://extensions`
* install a missing ACP adapter (Node 18+ required, `opensider install` does it)
* clear quarantine / MOTW bits

If a repair needs to overwrite something, tell the user before you do it. If the panel
still fails after two rounds, stop, collect the last 20 `host.log` lines, and hand the
user a short report instead of continuing to poke at it.
