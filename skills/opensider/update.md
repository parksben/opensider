# Update OpenSider

The side panel shows "扩展版本 / 桥接版本 / 最新版本" in its settings tab and offers a
**copy update prompt** button when either half is behind. That button is what usually
brings the user here — or they ask for it directly.

## Stage 1 — see what is installed and what is new

```sh
tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  https://github.com/parksben/opensider/releases/latest | sed 's#.*/tag/##')
bin=~/.opensider/runtime/opensider
"$bin" version                                       # bridge version
repo_ext=$("$bin" extension-dir)                     # the folder the browser loads
grep -o '"version": *"[^"]*"' "$repo_ext/manifest.json" | head -1   # extension version
```

Both numbers are compared against `$tag` (ignore a leading `v`; compare dotted numbers).
Only refresh the half that is older — but if you cannot tell, refreshing both is cheap
and safe.

Check: you can say which of the two (bridge, extension, both) is behind and by how much.

## Stage 2 — refresh the bridge

Ask the user to **close the OpenSider side panel** first: the bridge process only lives
while the panel is connected, and Windows cannot replace a running `.exe`.

Then repeat Stage 3 of [`install.md`](./install.md) (same download, same checksum check,
same quarantine / unblock step, same path) and re-run:

```sh
~/.opensider/runtime/opensider install
```

The install command is idempotent: it rewrites the manifests and keeps the workspace and
your ACP adapters. If the user's data ever looks off, `doctor.md` can tell you whether the
runtime and workspace are intact — do not "fix" it by deleting files.

Check: `~/.opensider/runtime/opensider version` prints the new tag.

## Stage 3 — refresh the extension

Same as Stage 4 of [`install.md`](./install.md): download `extension.zip` from the tag and
replace the contents of the extension folder — the one `opensider extension-dir` prints (it is
the folder the user picked during install and the browser is loading now).

Then tell the user the click that actually reloads it:

1. Open `chrome://extensions/` in their browser (command per OS in `install.md` Stage 5).
2. Click **Reload** (↻) on the OpenSider card.

Chrome does not pick up a rewritten unpacked folder on its own, so without this click
the panel keeps running the old code. If the card turns red or shows "invalid", the
folder was replaced while Chrome held files open — clicking Reload (or removing and
re-adding the folder) fixes it; check the `manifest.json` in that folder is still
valid first.

Check: the user confirms the extension card shows the new version (the number is printed
on the card), and the `manifest.json` in the extension folder matches `$tag`.

## Stage 4 — verify

Same as Stage 6 of [`install.md`](./install.md): ask the user to open the side panel and
look for a fresh `go host starting` line in `~/.opensider/host.log`.

Check: a new start line, and the side panel connects (the version row in settings shows
the new numbers).

## Notes

* Never update only one half on purpose: a bridge newer than the extension (or the other
  way round) is what the version row exists to warn about.
* Do not touch `~/.opensider/workspace`, `ui-state.json` or `outputs/` during an update.
* If the update prompt came from a *stale* check (the release moved again since), just
  re-resolve `$tag` and continue.
