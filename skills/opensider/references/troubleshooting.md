# Troubleshooting

Read the newest `~/.opensider/host.log` lines before acting on any of these. Fix one
thing, re-run the stage check, then move on.

## The panel asks for the install prompt (bridge missing)

The browser could not start the host. In order:

1. Is the manifest there **for this browser and this profile**? Paths per OS/browser:
   [`platforms.md`](./platforms.md). Snap and flatpak browsers read a different root —
   that is the most common miss.
2. Does the `path` inside the manifest point at an existing file?
   `cat <manifest>` → the binary must be `~/.opensider/runtime/opensider`.
3. Re-run `~/.opensider/runtime/opensider install` — it rewrites all manifests at once.
4. Still failing: reload the extension card in `chrome://extensions` and reopen the panel.
   Chrome reads the manifest at connect time, so no browser restart is required.

## "Native host has exited" / the host dies immediately

* macOS: quarantine still set on the binary (`xattr -p com.apple.quarantine <binary>`) →
  `xattr -d com.apple.quarantine <binary>`.
* Windows: mark-of-the-web → `Unblock-File <binary>`.
* Binary not executable → `chmod 755 ~/.opensider/runtime/opensider`.
* The binary was moved or replaced by something that is not the release build (a
  modified macOS arm64 binary is refused by Gatekeeper) → re-download and verify the
  checksum, do not re-sign it.

## Panel stuck at "starting…"

The host is alive but has not finished the CLI scan, or something is blocking the pipe.

* Give it a few seconds; if `idle agents=…` appears in the log, it is done — reload the
  panel.
* If nothing new is logged, the extension is talking to an old or wrong host: confirm
  `opensider version` and that the manifest `path` is the current binary, then re-run
  `opensider install`.
* Reload the extension card; if that does not help, restart the browser (last resort).

## "No ACP CLI found"

* No supported CLI installed → pick one from [`agents.md`](./agents.md) and install it,
  then log in once.
* Claude Code / Codex present but missing its adapter → needs Node 18+; re-run
  `opensider install` and read its output.
* CLI installed under a version manager → the bridge scans nvm / fnm / volta / asdf /
  bun / npm-global itself, so give it a moment before concluding it is missing.

## Loading unpacked fails

| Chrome says | Cause | Fix |
|---|---|---|
| "Manifest file is missing or unreadable" | the user selected the wrong folder (the parent, or a nested folder) | point them at the folder that **directly** contains `manifest.json` (`opensider extension-dir` prints it) |
| "Cannot load extension with file or directory name …" | the zip was not extracted, or extracted into a subfolder | re-unpack with the flags in `install.md` Stage 4 |
| card loads but turns red later | files were replaced while Chrome had them open | click **Reload** on the card; if it stays red, remove and load the folder again |
| the folder is gone from the picker | the user moved or cleaned the folder it was loaded from | re-unpack `extension.zip` into the recorded path (`opensider extension-dir`) and load it again — the bridge is unaffected |

## The extension is loaded but only in one profile

Unpacked extensions are per profile. If the user switches Chrome profiles, the side panel
is simply not there in the other one. Load the same folder again in that profile (the
bridge manifests are already written for every profile). Say this explicitly — it is easy
to mistake for a broken install.

## Enterprise / managed machines

`NativeMessagingBlocklist` (or a `NativeMessagingAllowlist` without us) in `chrome://policy`
stops the host from ever launching. Nothing in this skill can override a policy — read the
policy page with the user and tell them to ask IT to allow `com.opensider.host`, or to use
an unmanaged browser/profile.

## `chrome://extensions` did not open from the terminal

Some environments refuse to open internal URLs from a shell. Ask the user to paste
`chrome://extensions` into the address bar themselves and continue the walkthrough.

## The download 404s

* **Right after a release**: GitHub's CDN can serve a stale `releases/latest` redirect or
  404 an asset that was uploaded seconds ago. Resolve the tag from the **API**
  (`api.github.com/repos/parksben/opensider/releases/latest`) instead of the web redirect,
  and if an asset 404s, retry once with `-H 'Cache-Control: no-cache'` before assuming it is
  missing.
* `opensider-darwin-amd64` and `opensider-windows-arm64.exe` are optional assets — if one
  is missing for the user's machine, say so plainly and stop; do not substitute another
  architecture's binary (Rosetta or emulation is the user's call, not yours, and the
  manifest path must point at a binary that really runs).
* Any other 404: the tag you pinned may have been removed → re-resolve `latest` and retry.

## The panel connects but prompts fail

That is the **CLI**, not the bridge: the user is not logged in, or the CLI's config folder
has the wrong owner (`EACCES` on `~/.gemini`, `~/.codex`, …). Fix the login or the
ownership, and say which one it was.
