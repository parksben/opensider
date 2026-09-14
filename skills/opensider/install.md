# Install OpenSider

Work top to bottom. Each stage ends with a check — do not skip it.

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

Then look for the two things OpenSider needs locally:

1. **A supported Agent CLI** — run through the list in
   [`references/agents.md`](./references/agents.md) with `command -v`. Report what you
   found. If nothing is found, tell the user which CLI to install and log into first
   (they need at least one; OpenSider drives it, it is not bundled).
2. **Node 18+** (`node -v`, `npm -v`) — only needed for the Claude Code / Codex ACP
   adapters. Missing Node is not fatal; `opensider install` will say so.

Check: you can name the OS, the arch, the asset, and at least one CLI (or you have told
the user which one to install).

## Stage 2 — ask which browser

Detect the Chromium browsers on this machine (paths in
[`references/platforms.md`](./references/platforms.md)), show the user the ones you
actually found, and ask which one they normally use.

* Exactly one found → confirm it ("你平时用的是 Chrome，对吧？").
* Several found → make the user pick.
* None found → stop and ask them to install a Chromium browser first.

You will register the Native Messaging manifest for **every** detected browser, but the
"Load unpacked" walkthrough below is only for the browser they picked.

Check: you can name the browser and the exact application name you will open
(for example `Google Chrome`, `Microsoft Edge`, `Brave Browser`).

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

If the checksum is missing or does not match: delete the file, stop, and tell the user.

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
`Manifests:` list with at least one real browser path. Keep that version string — you
will compare it in `update.md`.

## Stage 4 — put the extension on disk

```sh
curl -fsSL -o "$tmp/extension.zip" "$base/extension.zip"
rm -rf ~/.opensider/extension
mkdir -p ~/.opensider/extension
unzip -q -o "$tmp/extension.zip" -d ~/.opensider/extension   # or: python3 -m zipfile -e
```

Windows (PowerShell): `Expand-Archive -LiteralPath "$tmp\extension.zip" -DestinationPath "$env:USERPROFILE\.opensider\extension" -Force`

`manifest.json` must end up **directly** inside `~/.opensider/extension/`.

Check: `test -f ~/.opensider/extension/manifest.json` (PowerShell:
`Test-Path "$env:USERPROFILE\.opensider\extension\manifest.json"`) and the file contains
`"manifest_version": 3`.

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
3. Select the folder `~/.opensider/extension`.
   * `~/.opensider` is a hidden folder, so the picker will not show it.
     macOS: press `⌘⇧G`, paste `~/.opensider/extension`, press Enter.
     Windows/Linux: paste the full path into the file-name box.
4. (Optional) Click the puzzle piece and pin OpenSider to the toolbar.

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
- Extension: loaded from ~/.opensider/extension
- Agents found: … (adapters installed for …)
Next: open the side panel, pick an agent, log in if it asks.
```

Mention one thing only if it applies: an adapter was installed for a CLI, Node is missing
so that CLI will not show up yet, or the Intel build did not exist for this machine.
