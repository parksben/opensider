# Platforms, browsers and where things live

## Paths

| What | macOS | Linux | Windows |
|---|---|---|---|
| Home root | `~/.opensider` | `~/.opensider` | `%USERPROFILE%\.opensider` |
| Bridge binary | `~/.opensider/runtime/opensider` | same | `…\runtime\opensider.exe` |
| Unpacked extension | `~/.opensider/extension` | same | `…\extension` |
| Host log | `~/.opensider/host.log` | same | `…\host.log` |
| Manifest name | `com.opensider.host.json` | same | same (registry value points at it) |
| Legacy name to clean up | `com.cursor.sidebar.host.json` | same | same |

## Release assets

`opensider-darwin-arm64`, `opensider-darwin-amd64` (optional), `opensider-linux-amd64`,
`opensider-linux-arm64`, `opensider-windows-amd64.exe`, `opensider-windows-arm64.exe`
(optional), `extension.zip`, `SHA256SUMS`.

Everything is downloaded from `https://github.com/parksben/opensider/releases/…`
(`/latest/download/` or `/download/<tag>/`), so no Git and no Go toolchain is needed.

macOS note: the darwin binaries are built with cgo and ad-hoc signed. Do not strip,
re-sign or modify them — Gatekeeper on Apple Silicon refuses to run a modified arm64
binary. A freshly downloaded file may carry the `com.apple.quarantine` attribute; clear
it once with `xattr -d com.apple.quarantine <path>` (a `curl` download usually has none).

Windows note: files downloaded through some tools carry a mark-of-the-web. Run
`Unblock-File <path>` so SmartScreen does not block the bridge Chrome is about to spawn.

## Browser roots (where `NativeMessagingHosts/` goes)

Each root also has per-profile subfolders (`Default`, `Profile 1`, …) which some Chrome
versions read instead of the root — `opensider install` writes both, and `uninstall`
removes both.

| Browser | macOS (`~/Library/Application Support/…`) | Linux (`~/.config/…`) | Windows (`%LOCALAPPDATA%\…`) |
|---|---|---|---|
| Chrome | `Google/Chrome` | `google-chrome` | `Google\Chrome\User Data` |
| Chrome Beta / Dev / Canary | `Google/Chrome Beta`, `… Dev`, `… Canary` | `google-chrome-beta`, `google-chrome-unstable` | `Google\Chrome Beta\User Data`, `Google\Chrome SxS\User Data` |
| Chromium | `Chromium` | `chromium` | `Chromium\User Data` |
| Microsoft Edge (+ Beta/Dev/Canary) | `Microsoft Edge`, `… Beta`, … | `microsoft-edge`, `… -beta`, `… -dev` | `Microsoft\Edge\User Data`, … |
| Brave (+ Beta/Nightly) | `BraveSoftware/Brave-Browser`, … | `BraveSoftware/Brave-Browser`, … | `BraveSoftware\Brave-Browser\User Data` |

Linux snap / flatpak installs use a different root:

* snap: `~/snap/<browser>/current/.config/<browser root>`
* flatpak: `~/.var/app/<app-id>/config/<browser root>` (Chrome:
  `~/.var/app/com.google.Chrome/config/google-chrome`)

If the user's browser came from a package like that, copy the manifest there too and say
so in your report — otherwise the panel will keep saying the bridge is missing.

## Opening the extensions page

| OS | Command |
|---|---|
| macOS | `open -a "Google Chrome" "chrome://extensions/"` (use the app the user picked) |
| Linux | `google-chrome "chrome://extensions/"` (or `microsoft-edge`, `brave-browser`, …) |
| Windows | PowerShell: `Start-Process "chrome" "chrome://extensions/"` |

App names to use with `open -a`: `Google Chrome`, `Google Chrome Beta`, `Chromium`,
`Microsoft Edge`, `Brave Browser`.

## The hidden-folder trap

`~/.opensider/extension` is inside a dot folder, so the "Load unpacked" dialog will not
show it. Tell the user how to reach it:

* macOS: `⌘⇧G` → paste `~/.opensider/extension` → Enter (or `⌘⇧.` to reveal hidden files)
* Windows / Linux: paste the absolute path into the file-name field

Without this, users conclude the extension is broken when they simply cannot see the
folder.

## Don't put the bridge in a protected folder

macOS TCC blocks background helpers from Desktop / Documents / Downloads. The bridge
always lives in `~/.opensider/runtime` — never download it straight into Downloads and
register it from there.
