# How to verify each stage

Verification is what separates "I ran the commands" from "it works". Use these checks —
they are cheap and they never lie.

## The log is the source of truth

`~/.opensider/host.log` records everything the bridge does. Lines you will look for:

| Line | Written when | Means |
|---|---|---|
| `go host starting` | every time a browser launches the bridge | Chrome → bridge works. **This is the one that matters.** |
| `install complete host=…` | after `opensider install` | registration finished |
| `uninstall purge=…` | after `opensider uninstall` | cleanup ran |
| `release latest=v…` | background version check | the check succeeded |
| `idle agents=…` | CLI scan finished | which CLIs the bridge can see |

```sh
tail -n 12 ~/.opensider/host.log
```

Windows: `Get-Content -Tail 12 "$env:USERPROFILE\.opensider\host.log"`.

## Stage checks

**Bridge install** — `opensider install` printed `Registered com.opensider.host`, a
`Version:` line, and a `Manifests:` list with at least one real browser path:

```sh
~/.opensider/runtime/opensider version
ls ~/.opensider/runtime/opensider
```

**Extension on disk** — the folder Chrome loads (`opensider extension-dir` prints it, and it is
the folder the user picked during install):

```sh
repo_ext=$(~/.opensider/runtime/opensider extension-dir)
test -f "$repo_ext/manifest.json" && echo OK
```

**Extension actually loaded (the user's click)** — ask the user, then look for the fresh
bridge start:

```sh
before=$(grep -c 'go host starting' ~/.opensider/host.log 2>/dev/null || echo 0)
# …user clicks the toolbar icon and the side panel opens…
after=$(grep -c 'go host starting' ~/.opensider/host.log 2>/dev/null || echo 0)
echo "$before -> $after"
```

`after > before` (or the first-ever line appearing) proves the whole chain: the
extension is loaded, its manifest allowed origin matches, and Chrome spawned our host.

**Agents** — the panel lists them; `idle agents=` in the log names them from the bridge's
side. An empty list with `agents=none` means no supported CLI was detected — see
[`agents.md`](./agents.md).

## Reading the panel's connection states

| Panel state | Meaning |
|---|---|
| asks for the install prompt | the browser could not start the host: manifest missing for **this** browser/profile |
| starting… | host is up, CLI scan in progress (should clear in seconds) |
| connected, model + agent menus visible | done |
| no agents found | bridge fine, no CLI/adapter found |
| error naming `~/.opensider/host.log` | the host exited; read the last lines |

## What "done" looks like

1. `opensider version` prints the tag you installed
2. the extension folder (`opensider extension-dir`) holds a valid MV3 `manifest.json`
3. the user's browser shows the OpenSider card with no error
4. a fresh `go host starting` line appeared after they opened the panel
5. the panel lists at least one agent

If 4 or 5 fails, do not re-run the whole install — go to
[`troubleshooting.md`](./troubleshooting.md) and read the newest log lines.
