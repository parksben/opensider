# Platforms, browsers and where things live

## Paths

| What | macOS | Linux | Windows |
|---|---|---|---|
| Home root | `~/.opensider` | `~/.opensider` | `%USERPROFILE%\.opensider` |
| Bridge binary | `~/.opensider/runtime/opensider` | same | `…\runtime\opensider.exe` |
| Unpacked extension | user's choice, `~/OpenSider` suggested | same | user's choice, `%USERPROFILE%\OpenSider` suggested |
| Downloaded package | `<parent of the extension folder>/OpenSider-extension-<tag>.zip` | same | same |
| Host log | `~/.opensider/host.log` | same | `…\host.log` |
| Manifest name | `com.opensider.host.json` | same | same (registry value points at it) |
| Legacy name to clean up | `com.cursor.sidebar.host.json` | same | same |

## Release assets

`opensider-darwin-arm64`, `opensider-darwin-amd64` (optional), `opensider-linux-amd64`,
`opensider-linux-arm64`, `opensider-windows-amd64.exe`, `opensider-windows-arm64.exe`
(optional), `extension.zip`, `SHA256SUMS`.

Everything is downloaded from `https://github.com/parksben/opensider/releases/…`
(`/download/<tag>/` after the tag is pinned — do not use the cached web
`/latest/download/` hop as the source of truth), so no Git and no Go toolchain
is needed. How to pull those URLs fast — parallel files + Range on the GitHub
CDN — is in [`download.md`](./download.md).

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

## Where the extension folder lives

The unpacked extension is a plain folder the browser loads from on every start, so it has to
sit somewhere the user is happy to keep. **The user picks it** — ask, and wait: no folder is
created, no zip is downloaded and no path is recorded until they name one (see stage 4 of
`install.md`).

Suggest `~/OpenSider` and say why: `<Downloads>/OpenSider` is a tempting default, but cleanup
tools and "clear my downloads" habits delete it, and a deleted folder means a broken extension
until it is loaded again. The one hard rule: **not inside `~/.opensider`**, because dot folders
are invisible in the "Load unpacked" dialog and that turns the single manual step into a puzzle.

| Option | Notes |
|---|---|
| `~/OpenSider` | suggested first: visible, durable, nothing wipes it |
| `~/Downloads/OpenSider` | only if the user really wants it; warn that clearing Downloads breaks the extension |
| any other absolute path | use it exactly as given |

The browser question works the same way: detect first, then let the user confirm the browser —
including when you only find one ("only Chrome here, is that the one?").

The choice is recorded in `~/.opensider/extension-path`, and every flow reads it back through
the binary — never hand-write that file:

```sh
~/.opensider/runtime/opensider extension-dir                       # print it
~/.opensider/runtime/opensider extension-dir "/some/other/folder"  # set it
```

Two things to pass on to the user:

* The folder must **stay where it is** — Chrome loads the extension from it on every
  start. Moving or deleting it breaks the extension until they load it again from the new
  place.
* The `OpenSider-extension-<tag>.zip` beside it is the package they can re-use
  (or re-install from) without asking an agent.

## Don't put the bridge in a protected folder

macOS TCC blocks background helpers from Desktop / Documents / Downloads. The bridge
always lives in `~/.opensider/runtime` — never download the binary straight into Downloads
and register it from there. (The *extension* folder is different — Chrome reads it as a
plain directory — but it still should not sit in Downloads, for the reason above.)
