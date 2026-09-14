# Uninstall OpenSider

Two halves, two owners: the bridge you remove yourself, the extension only the user can
remove from `chrome://extensions`. And there is data — ask about it, never assume.

## Stage 1 — tell the user what is there, then ask about data

`~/.opensider` contains:

| Item | What it is | Lost if deleted |
|---|---|---|
| `workspace/` | page snapshots the Agent reads | nothing important (it is regenerated) |
| `workspace/outputs/` | files the Agent wrote for the user | **yes — real user files** |
| `ui-state.json` | session list and every chat message | **yes — the whole chat history** |
| `host.log`, `release-check.json` | logs and the version cache | nothing important |
| `runtime/` | the bridge binary + ACP adapters | nothing important (reinstallable) |

Ask one clear question: **remove everything (`~/.opensider` included), or keep the chat
history and outputs?** Offer "keep" first — it is the reversible choice. If they keep it,
say where it is, so they can delete it later if they want.

Check: you have an explicit answer, and you have not deleted anything yet.

## Stage 2 — unregister the bridge

```sh
~/.opensider/runtime/opensider uninstall            # keeps ~/.opensider
~/.opensider/runtime/opensider uninstall --purge    # also removes ~/.opensider
```

This deletes every `com.opensider.host.json` manifest (including per-profile folders and
the legacy `com.cursor.sidebar.host.json`), the Windows registry keys, `runtime/`, and —
only with `--purge` — the whole `~/.opensider` folder.

Check: the output lists the manifest paths it removed plus `Removed ~/.opensider/runtime`.
Browsers read manifests at connect time, so nothing needs a restart.

## Stage 3 — remove the extension (the user's click)

1. Open `chrome://extensions/` in the browser they use.
2. Find the OpenSider card, click **Remove**, confirm.

Do this for every browser profile where they loaded it — a Chrome-only manifest cleanup
does not remove a copy they loaded in Edge as well. If they are not sure, `doctor.md`
Stage 1 tells you which browsers have the bridge registered, and the extensions page
tells them which have the card.

Then tidy up the files under Downloads (nothing here is read by anything once the card is
gone):

* the unpacked folder `<Downloads>/OpenSider`
* the package `<Downloads>/OpenSider-extension-<tag>.zip`

Ask before deleting them — some users want to keep the zip for a later reinstall.

Check: either the user confirms the card is gone, or they say they want to keep using it
(an uninstalled bridge with a loaded extension leaves the panel showing a helpful "send
this prompt to your AI Agent" screen — that is expected, not a failure).

## Stage 4 — report

```
Done.
- Bridge: removed (manifests in Chrome and Edge, registry keys, ~/.opensider/runtime)
- Local data: kept at ~/.opensider — delete it whenever you want
- Extension: removed from Chrome
```

If they kept the data and later reinstall, the chat history comes back on the first
connect (it is mirrored in `~/.opensider/ui-state.json`).
