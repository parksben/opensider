# Install OpenSider

Work top to bottom. Each stage ends with a check — do not skip it.

## Stage 0 — put the plan in front of the user

Before touching anything, show the whole install as a todo list and keep it updated as you
go (your todo tool if you have one, otherwise a checklist in the chat):

1. detect the machine (OS, browsers, Agent CLIs)
2. confirm which browser to set up
3. confirm where the extension folder goes
4. install and register the bridge
5. unpack the extension and load it in the browser (the user clicks)
6. verify the whole chain

Rules 1–9 of `SKILL.md` apply to every line above; steps 2 and 3 are questions, and nothing
is downloaded, created or unpacked before both are answered.

## Stage 1 — detect

```sh
uname -s   # Darwin | Linux
uname -m   # arm64 | aarch64 | x86_64
```

On Windows use PowerShell instead (`$env:PROCESSOR_ARCHITEW6432`, `$env:PROCESSOR_ARCHITECTURE`).

| OS | arch | asset name |
|---|---|---|
| macOS | arm64 (Apple Silicon) | `opensider-darwin-arm64` |
| macOS | x86_64 (Intel) | `opensider-darwin-amd64` — **may not exist**; if the download 404s, stop and tell the user to ask for an Intel build |
| Linux | x86_64 | `opensider-linux-amd64` |
| Linux | aarch64 | `opensider-linux-arm64` |
| Windows | ARM64 | `opensider-windows-arm64.exe` |
| Windows | AMD64 | `opensider-windows-amd64.exe` |

Then look for what OpenSider needs locally:

1. **A supported Agent CLI** — walk the list in [`references/agents.md`](./references/agents.md)
   with `command -v`. Report what you found.

   * **Found one or more** → continue. `opensider install` adds the Claude Code / Codex ACP
     adapter automatically when the CLI is there but the adapter is not.
   * **Found none** → say so plainly, then **keep going**. The bridge and the extension are
     still worth installing: they sit ready and show up the moment a CLI exists. Tell the
     user, in this order:
     1. OpenSider does not ship an agent — it drives one that is already installed here,
        so nothing can connect until one exists. This is not an install failure.
     2. Which one to install, with the concrete command (`claude`, `codex`, `copilot`,
        `opencode`, `agent` …). The shortest path is usually the agent they are talking to
        right now: if you are Claude Code, `claude` is already on this machine and only the
        ACP adapter is missing — `opensider install` will add it. If they chat through an
        IDE's built-in assistant, that CLI may not exist on this machine at all.
     3. Claude Code and Codex need Node 18+ for their adapter: if `node -v` fails, point
        them at a CLI that speaks ACP by itself (Copilot / OpenCode / Cursor / Gemini …).
     4. Once they install one, the side panel lists it on the next connect — nothing has
        to be reinstalled. Offer to re-run [`doctor.md`](./doctor.md) afterwards.
   Then continue with Stage 2. Do not abort the install because of a missing CLI.

2. **Node 18+** (`node -v`, `npm -v`) — only needed for the Claude Code / Codex ACP
   adapters. Missing Node is not fatal; `opensider install` will say so.

Check: you can name the OS, the arch, the asset, and either at least one CLI or the exact
CLI you told the user to install.

## Stage 2 — ask which browser

Detect the Chromium browsers on this machine (paths in
[`references/platforms.md`](./references/platforms.md)), show the user the ones you
actually found, and ask which one they normally use. **Ask, then stop and wait** — this is
their call even when the answer looks obvious.

* Exactly one found → still ask, and say what you found ("本机只检测到 Chrome，就装到它上面吗？").
  Move on only after they say yes.
* Several found → list them and make the user pick.
* None found → stop and ask them to install a Chromium browser first.

You will register the Native Messaging manifest for **every** detected browser, but the
"Load unpacked" walkthrough below is only for the browser they picked.

Check: the user has told you, in their own words, which browser to use, and you can name the
exact application you will open (for example `Google Chrome`, `Microsoft Edge`,
`Brave Browser`).

## Stage 3 — install the bridge

Download the binary and its checksum file from the pinned tag (see `SKILL.md` step 1):

```sh
tmp=$(mktemp -d)
base="https://github.com/parksben/opensider/releases/download/$tag"
curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"
curl -fsSL -o "$tmp/$asset" "$base/$asset"
```

Verify before you place anything:

```sh
expected=$(awk -v n="$asset" '$2 == n || $2 == "*" n { print $1 }' "$tmp/SHA256SUMS")
actual=$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')   # sha256sum on Linux
[ -n "$expected" ] && [ "$expected" = "$actual" ] || echo MISMATCH
```

If the checksum is missing or does not match: re-download **both** files once — GitHub's CDN
can serve a stale copy of either right after a release — and compare again:

```sh
curl -fsSL -H 'Cache-Control: no-cache' -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"
curl -fsSL -H 'Cache-Control: no-cache' -o "$tmp/$asset" "$base/$asset"
```

Only if it still mismatches: delete the file, stop, and tell the user what you saw (which
files, which hashes) instead of installing something you could not verify.

Place it where the manifests point (`~/.opensider/runtime/`):

```sh
mkdir -p ~/.opensider/runtime
mv "$tmp/$asset" ~/.opensider/runtime/opensider
chmod 755 ~/.opensider/runtime/opensider
xattr -d com.apple.quarantine ~/.opensider/runtime/opensider 2>/dev/null || true   # macOS
```

Windows (PowerShell):

```powershell
$tmp = Join-Path $env:TEMP "opensider"
New-Item -ItemType Directory -Force $tmp | Out-Null
$base = "https://github.com/parksben/opensider/releases/download/$tag"
Invoke-WebRequest -Uri "$base/$asset" -OutFile "$tmp\opensider.exe"
# compare (Get-FileHash "$tmp\opensider.exe" -Algorithm SHA256).Hash with SHA256SUMS
Unblock-File "$tmp\opensider.exe"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.opensider\runtime" | Out-Null
Move-Item -Force "$tmp\opensider.exe" "$env:USERPROFILE\.opensider\runtime\opensider.exe"
```

Register it. This writes the manifests, prepares the workspace and installs the
Claude / Codex ACP adapters when needed (and only then):

```sh
~/.opensider/runtime/opensider install
```

Check: the output contains `Registered com.opensider.host`, a `Version:` line, and a
`Manifests:` list with at least one real browser path. The version line is dotted (`0.2.2`,
never `v0.2.2`) — keep it, you will compare it in `update.md`.

## Stage 4 — ask where the extension should live, then unpack it

The browser loads the extension from this folder on every start, so it needs a home the user
is happy to keep. Do this in order, and do not reorder it:

**4a — ask, and stop.** Put the choice in front of them, with the trade-off that matters:

| Offer | Say this |
|---|---|
| `~/OpenSider` | in the home folder, out of reach of "clear my downloads" habits and cleanup tools |
| `<Downloads>/OpenSider` | convenient, but wiping Downloads deletes it — the extension then shows as broken until it is loaded again |
| their own absolute path | fine as long as it stays put; use it exactly as given |

Then **wait**. "你帮我选" / "whatever you think" is an answer — take `~/OpenSider` and tell
them that is what you took. Anything else needs their own words naming a path; a nod at your
*suggestion* is not a decision. Do not create the folder, download the zip or write the path
record before that answer — if you catch yourself doing any of those, stop and ask first.

**4b — record it** (`opensider extension-dir <path>`), so this stage, `update.md`,
`doctor.md` and the `opensider install` output all read the same path back. Never inside
`~/.opensider`: dot folders are invisible in the "Load unpacked" picker.

```sh
bin=~/.opensider/runtime/opensider
target=$("$bin" extension-dir "$HOME/OpenSider")   # stores it, prints the path
# on any later run just read it back:  target=$("$bin" extension-dir)
```

Windows (PowerShell):

```powershell
$bin = "$env:USERPROFILE\.opensider\runtime\opensider.exe"
$target = & $bin extension-dir "$env:USERPROFILE\OpenSider"
```

**4c — download and unpack into it** (only now):

```sh
parent=$(dirname "$target")
curl -fsSL -o "$parent/OpenSider-extension-$tag.zip" "$base/extension.zip"
rm -rf "$target"
mkdir -p "$target"
unzip -q -o "$parent/OpenSider-extension-$tag.zip" -d "$target"   # or: python3 -m zipfile -e
```

Windows (PowerShell):

```powershell
$parent = Split-Path -Parent $target
Invoke-WebRequest -Uri "$base/extension.zip" -OutFile "$parent\OpenSider-extension-$tag.zip"
Remove-Item -Recurse -Force $target -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath "$parent\OpenSider-extension-$tag.zip" -DestinationPath $target -Force
```

Keeping the zip beside the folder is deliberate — it is the installer the user can reuse
without you. `manifest.json` must end up **directly** inside the target folder.

Check: `test -f "$target/manifest.json"` (PowerShell: `Test-Path "$target\manifest.json"`)
and the file contains `"manifest_version": 3`.

## Stage 5 — let the user load it (this part is theirs)

Open the extensions page in **their** browser:

```sh
open -a "Google Chrome" "chrome://extensions/"            # macOS (use the app they picked)
google-chrome "chrome://extensions/"                      # Linux
Start-Process "chrome" "chrome://extensions/"             # Windows (PowerShell)
```

Then walk them through it, one click at a time:

1. Turn on **Developer mode** (top right).
2. Click **Load unpacked**.
3. Select the folder the user picked in Stage 4 (`opensider extension-dir` prints it again).
   It is a visible folder, so no hidden-file tricks are needed; give them the exact path
   anyway, so nobody has to guess.
4. (Optional) Click the puzzle piece and pin OpenSider to the toolbar.

Also tell them this folder has to stay where it is: Chrome loads the extension from it on
every start, so moving or deleting it breaks the extension until they load it again.

Wait for the user to confirm. If the card shows an error instead, do not retry blindly —
go to [`references/troubleshooting.md`](./references/troubleshooting.md).

Check: the extension card is present and has no error badge; the user confirms it is there.

## Stage 6 — verify end to end

Ask the user to click the OpenSider toolbar icon (the side panel opens), then:

```sh
tail -n 8 ~/.opensider/host.log
~/.opensider/runtime/opensider version
```

A **new** `go host starting` line timed after the user opened the panel means Chrome
launched the bridge — the bridge and the extension are talking. Details and what to do
when the line is missing: [`references/verification.md`](./references/verification.md).

If the side panel lists agents, the install is done. If it says no CLI was found, that is
Stage 1 work, not a bridge problem.

## Stage 7 — hand over

Report (short):

```
OpenSider is ready.
- Bridge: v0.2.0, registered for Chrome
- Extension: loaded from <the folder the user picked>
- Agents found: … (adapters installed for …)
Next: open the side panel, pick an agent, log in if it asks.
```

Mention one thing only if it applies: an adapter was installed for a CLI, **no CLI was
found** (name the one you told them to install and that nothing else is missing), Node is
missing so that CLI will not show up yet, or the Intel build did not exist for this machine.
