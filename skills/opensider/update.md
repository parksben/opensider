# Update OpenSider

The side panel shows "扩展版本 / 桥接版本 / 最新版本" in its settings tab and offers a
**copy update prompt** button when either half is behind. That button is what usually
brings the user here — or they ask for it directly.

## Stage 1 — see what is installed and what is new

`$tag` and `$DL_ROUTE` come from `SKILL.md` step 1 — reuse them. Do **not** re-resolve the
release through the web `/releases/latest` hop: it is CDN-cached and can still point at the
previous tag minutes after a release. If you got here without step 1 (the user asked for an
update out of the blue), pin the tag exactly as step 1 does: API first (direct, then through
`https://gh-proxy.com`), `Cache-Control: no-cache` on every call, web redirect only as a
last resort, and pick `DL_ROUTE` the same way (`dl_probe` in
[`references/download.md`](./references/download.md)).

```sh
bin=~/.opensider/runtime/opensider
"$bin" version                                       # bridge version
repo_ext=$("$bin" extension-dir)                     # the folder the browser loads
grep -o '"version": *"[^"]*"' "$repo_ext/manifest.json" | head -1   # extension version
```

Both numbers are compared against `$tag` (ignore the tag's leading `v`: every version the
tools print is dotted, `0.2.2`, never `v0.2.2`).
Only refresh the half that is older — but if you cannot tell, refreshing both is cheap
and safe.

Check: you can say which of the two (bridge, extension, both) is behind and by how much.

## Stage 2 — refresh the bridge

Ask the user to **close the OpenSider side panel** first: the bridge process only lives
while the panel is connected, and Windows cannot replace a running `.exe`.

Then repeat Stage 3 of [`install.md`](./install.md) (same route-aware download from
[`references/download.md`](./references/download.md), same `dl_probe` on the new binary —
the network may have changed since the install, same checksum check, same quarantine /
unblock step, same path) and re-run:

```sh
if [ "$DL_ROUTE" = mirror ]; then
  npm_config_registry=https://registry.npmmirror.com "$bin" install
else
  "$bin" install
fi
```

The install command is idempotent: it rewrites the manifests and keeps the workspace and
your ACP adapters. If the user's data ever looks off, `doctor.md` can tell you whether the
runtime and workspace are intact — do not "fix" it by deleting files.

Check: `~/.opensider/runtime/opensider version` prints the new version — the dotted numbers of
the tag, without its `v` prefix.

## Stage 3 — refresh the extension

Same as Stage 4 of [`install.md`](./install.md): download `extension.zip` from the tag
with the helper in [`references/download.md`](./references/download.md) and
replace the contents of the extension folder — the one `opensider extension-dir` prints (it is
the folder the user picked during install and the browser is loading now). `extension.zip`
is under 1 MiB, so it is a plain GET on either route; if the checksum or the version inside
does not match `$tag`, take the mirror cache seriously — re-fetch with `fresh` through the
**other** route before reporting a problem.

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
