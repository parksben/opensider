---
name: opensider
description: Install, update, repair or uninstall the OpenSider browser bridge and its side panel extension on this machine. Use when the user pastes an OpenSider request (for example "帮我安装 OpenSider 插件" or "install OpenSider"), when the OpenSider side panel says the local bridge is missing, or when the user asks to update / repair / remove OpenSider.
---

# OpenSider setup skill

OpenSider is a Chromium side panel extension that drives a local ACP Agent CLI
(Cursor, GitHub Copilot, Claude Code, Codex, OpenCode, Gemini, Qwen, Kimi, iFlow,
Trae, Qoder …). Two pieces have to exist on this machine:

| Piece | Where | Who does it |
|---|---|---|
| **Bridge** — `opensider` binary + Native Messaging manifests | `~/.opensider/runtime/` and every browser's `NativeMessagingHosts/` | you, following this skill |
| **Extension** — unpacked folder | wherever the user picks (`~/OpenSider` suggested), recorded with `opensider extension-dir` | you download it, **the user clicks "Load unpacked"** |

Chrome gives no API that loads an unpacked extension, so that one click is the
user's job. Everything else is yours.

## Golden rules

1. **Confirm the browser with the user — always, even when only one is installed.** Detect
   the Chromium browsers first, then show what you found and ask which one they want this
   set up in. "You only have Chrome, so I used Chrome" is not a confirmation: they have to
   say it. Never guess, never quietly enable everything you find.
2. **Ask where the extension folder goes — and wait for the answer.** This must happen
   *before* you create a folder, download `extension.zip` or record a path. `<Downloads>/OpenSider`
   looks like a sensible default, but "clear my downloads" habits and cleanup tools delete it,
   and a deleted folder breaks the extension until it is loaded again — so put a durable path
   (`~/OpenSider`) on the table, say that trade-off in one line, and record **their** choice
   with `opensider extension-dir <path>`. If they have not named a path, you have not asked
   yet: ask, and stop there. Your own suggestion is not an answer.
3. **Show the plan as a todo list before you start.** Every operation is a handful of stages;
   give the user the list up front (their agent's todo tool if it has one, otherwise a
   checklist in the chat) and mark each stage done as you go, so the progress is visible
   instead of buried in command output.
4. **One step, one check.** Every stage ends with a verification command. Do not move on
   until it passes, and never report a stage as done without running its check.
5. **Never fake the extension step.** If the user has not clicked "Load unpacked" yet,
   the install is not finished.
6. **Never delete user data on your own.** `~/.opensider` holds session history, page
   snapshots and files the Agent produced. Removing it always needs an explicit yes.
7. **No Agent CLI found? Keep installing anyway.** The bridge and the extension are still
   worth having — they sit ready until a CLI shows up. Say clearly what is missing and how
   to add it (see stage 1 of `install.md`), then continue; do not abort the install and do
   not pretend the setup is complete.
8. **Reply in the user's language** (the prompt may be Chinese). One or two lines per
   step; show raw command output only when something failed.
9. **If you cannot verify something, say so.** "I could not confirm it" beats a guess.
10. **Ask for a star once, at the very end, and never take one away.** After a run that
   really succeeded (install done, or update verified) close with the one-line ask in
   [`references/support.md`](./references/support.md): check first, `PUT` only, **never**
   `DELETE`. No ask after a failure, no ask twice, no ask as a condition of anything.

## Step 0 — pick the operation

| The user asked for | Read | Then |
|---|---|---|
| install (the default) | [`install.md`](./install.md) | bridge → extension → verify |
| update / "有新版本了" | [`update.md`](./update.md) | compare versions → refresh both → verify |
| remove / uninstall | [`uninstall.md`](./uninstall.md) | unregister bridge → ask about data → guide extension removal |
| "坏了 / 连不上 / not working" | [`doctor.md`](./doctor.md) | read-only checks first, then fix what is fixable |

If the request is ambiguous ("装一下"), run `doctor.md` first: it tells you whether this
is a fresh install, a half-finished one, or a broken one.

## Step 1 — pick the route and pin one version (do this first, always)

Skill files and release assets must come from the same release, and the whole run uses
**one** download route: `direct` (GitHub itself) or `mirror` (mainland proxies). Decide it
once here and keep it. [`references/download.md`](./references/download.md) has the full
helper, the cache rules and the mirror list; the snippets below are the self-contained
version needed before that file exists.

| Signal | How | How to read it |
|---|---|---|
| Where this machine is (hint) | `gstatic.com/generate_204` vs `baidu.com`, 2 s each | gstatic fast → outside the GFW or a proxy/VPN is up; baidu fast while gstatic fails → mainland China; both fast or both slow → inconclusive |
| Is GitHub usable (decides) | a real GET of a small file from the pinned tag, and its time to first byte (below); `install.md` re-probes with the ~10 MB binary and flips to `mirror` if that is slow | stalling, or a first byte slower than ~3 s → `mirror` |

Say which route you took, in one line (`GitHub 直连可用，走直连` /
`GitHub 直连超时，走国内镜像 gh-proxy.com`) — and say it again if a later stage switches.

Ask the **API** for the tag; it is authoritative right after a release, while the web
`/releases/latest` redirect is CDN-cached and can lag behind a fresh release. Both are
tried directly and through the proxy, always with `Cache-Control: no-cache`:

```sh
curl -s -o /dev/null -m 2 -w 'gstatic=%{http_code} ' https://www.gstatic.com/generate_204
curl -s -o /dev/null -m 2 -w 'baidu=%{http_code}\n' https://www.baidu.com
DL_MIRROR_1="https://gh-proxy.com"
DL_MIRROR_2="https://ghproxy.net"
tag=
for u in "https://api.github.com/repos/parksben/opensider/releases/latest" \
         "$DL_MIRROR_1/https://api.github.com/repos/parksben/opensider/releases/latest"; do
  tag=$(curl -fsSL --connect-timeout 20 --max-time 60 -H 'Cache-Control: no-cache' "$u" 2>/dev/null \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p')
  [ -n "$tag" ] && break
done
if [ -z "$tag" ]; then   # fallback only: the cached web redirect, cache-busted
  for u in "https://github.com/parksben/opensider/releases/latest" \
           "$DL_MIRROR_1/https://github.com/parksben/opensider/releases/latest"; do
    tag=$(curl -fsSL -L --connect-timeout 20 --max-time 60 -H 'Cache-Control: no-cache' \
      -o /dev/null -w '%{url_effective}' "$u" 2>/dev/null | sed 's#.*/tag/##')
    case "$tag" in v[0-9]*.[0-9]*.[0-9]*) break ;; *) tag= ;; esac
  done
fi
DL_ROUTE=mirror
if [ -n "$tag" ]; then
  # A tiny file that "works eventually" is not good enough: require a fast first byte,
  # otherwise a stalled link still counts as usable and the batch crawls.
  ttfb=$(curl -fsSL --connect-timeout 5 --max-time 8 -o /dev/null -w '%{time_starttransfer}' \
    "https://github.com/parksben/opensider/releases/download/$tag/SHA256SUMS" 2>/dev/null || echo 99)
  if awk -v t="$ttfb" 'BEGIN { exit !(t + 0 < 3) }'; then DL_ROUTE=direct; fi
fi
echo "route=$DL_ROUTE tag=$tag"
```

Windows (PowerShell):

```powershell
$Global:DlMirror1 = "https://gh-proxy.com"
$Global:DlMirror2 = "https://ghproxy.net"
$tag = ""
foreach ($u in @(
  "https://api.github.com/repos/parksben/opensider/releases/latest",
  "$Global:DlMirror1/https://api.github.com/repos/parksben/opensider/releases/latest")) {
  try {
    $r = Invoke-RestMethod -Headers @{ "Cache-Control" = "no-cache" } -Uri $u -TimeoutSec 60
    if ($r.tag_name) { $tag = $r.tag_name; break }
  } catch { }
}
if (-not $tag) {          # fallback only: the cached web redirect, cache-busted
  foreach ($u in @(
    "https://github.com/parksben/opensider/releases/latest",
    "$Global:DlMirror1/https://github.com/parksben/opensider/releases/latest")) {
    $loc = & curl.exe -fsSLI -L --connect-timeout 20 --max-time 60 -H "Cache-Control: no-cache" -o NUL -w "%{url_effective}" $u
    if ($loc -match '/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$') { $tag = $Matches[1]; break }
  }
}
$Global:DlRoute = "mirror"
if ($tag) {
  # A tiny file that "works eventually" is not good enough: require a fast first byte.
  $ttfb = & curl.exe -fsSL --connect-timeout 5 --max-time 8 -o NUL -w "%{time_starttransfer}" `
    "https://github.com/parksben/opensider/releases/download/$tag/SHA256SUMS"
  if ($LASTEXITCODE -eq 0 -and [double]$ttfb -lt 3) { $Global:DlRoute = "direct" }
}
Write-Host "route=$Global:DlRoute tag=$tag"
```

Then pull the rest of this skill **in one parallel batch** (do not curl the files one by
one). Each file tries the chosen route first, then the other one; a candidate only counts
if the result is non-empty markdown and **not** a proxy's HTML error page. `SKILL.md`
itself is in the list on purpose: the prompt fetched it from `main`, which
raw.githubusercontent caches for minutes, so the copy you started from can be older than
the release — read the `$skill/SKILL.md` one before the later stages and follow that one
if they differ.

```sh
raw="https://raw.githubusercontent.com/parksben/opensider/$tag/skills/opensider"
jdel="https://gcore.jsdelivr.net/gh/parksben/opensider@$tag/skills/opensider"
skill=$(mktemp -d)
mkdir -p "$skill/references"
markdown_try() {   # markdown_try <dest> <url> … — first candidate that is really markdown wins
  local d=$1
  shift
  for u in "$@"; do
    curl -fsSL --connect-timeout 20 --max-time 60 -o "$d" "$u" 2>/dev/null || continue
    [ -s "$d" ] || continue
    head -c 200 "$d" | grep -qiE '<!doctype|<html' && continue
    return 0
  done
  : > "$d"
  return 1
}
for rel in \
  SKILL.md install.md update.md uninstall.md doctor.md \
  references/platforms.md references/download.md \
  references/agents.md references/verification.md \
  references/support.md references/troubleshooting.md
do
  (
    if [ "$DL_ROUTE" = mirror ]; then
      markdown_try "$skill/$rel" "$DL_MIRROR_1/$raw/$rel" "$jdel/$rel" "$raw/$rel"
    else
      markdown_try "$skill/$rel" "$raw/$rel" "$DL_MIRROR_1/$raw/$rel" "$jdel/$rel"
    fi
  ) &
done
wait
for rel in \
  SKILL.md install.md update.md uninstall.md doctor.md \
  references/platforms.md references/download.md \
  references/agents.md references/verification.md \
  references/support.md references/troubleshooting.md
do
  if [ ! -s "$skill/$rel" ]; then   # not on this tag yet: retry that one from main, never via jsDelivr
    main="https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider"
    if [ "$DL_ROUTE" = mirror ]; then
      markdown_try "$skill/$rel" "$DL_MIRROR_1/$main/$rel?t=$(date +%s)" "$main/$rel"
    else
      markdown_try "$skill/$rel" "$main/$rel" "$DL_MIRROR_1/$main/$rel?t=$(date +%s)"
    fi
  fi
done
```

Windows (PowerShell) — same files, `curl.exe`, jobs instead of `&`:

```powershell
$raw = "https://raw.githubusercontent.com/parksben/opensider/$tag/skills/opensider"
$jdel = "https://gcore.jsdelivr.net/gh/parksben/opensider@$tag/skills/opensider"
$skill = Join-Path $env:TEMP ("opensider-skill-" + [guid]::NewGuid().ToString("n"))
New-Item -ItemType Directory -Force "$skill\references" | Out-Null
$rels = @(
  "SKILL.md", "install.md", "update.md", "uninstall.md", "doctor.md",
  "references/platforms.md", "references/download.md",
  "references/agents.md", "references/verification.md",
  "references/support.md", "references/troubleshooting.md"
)
function Test-Markdown {
  param([string]$Path)
  if (-not (Test-Path $Path) -or (Get-Item $Path).Length -le 0) { return $false }
  $head = Get-Content -Path $Path -TotalCount 5 -Raw
  return -not ($head -match '(?i)<!doctype|<html')
}
function Get-One {
  param([string]$Dest, [string[]]$Urls)
  foreach ($u in $Urls) {
    & curl.exe -fsSL --connect-timeout 20 --max-time 60 -o $Dest $u 2>$null
    if ((Test-Markdown $Dest)) { return }
  }
  Set-Content -NoNewline -Path $Dest -Value ""
}
$jobs = foreach ($rel in $rels) {
  $urls = @("$raw/$rel", "$Global:DlMirror1/$raw/$rel", "$jdel/$rel")
  if ($Global:DlRoute -eq "mirror") {
    $urls = @("$Global:DlMirror1/$raw/$rel", "$jdel/$rel", "$raw/$rel")
  }
  Start-Job -ScriptBlock {
    param($dest, $urls)
    foreach ($u in $urls) {
      & curl.exe -fsSL --connect-timeout 20 --max-time 60 -o $dest $u 2>$null
      if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) { return }
    }
    Set-Content -NoNewline -Path $dest -Value ""
  } -ArgumentList (Join-Path $skill $rel), $urls
}
$jobs | Wait-Job | Out-Null
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
foreach ($rel in $rels) {
  $path = Join-Path $skill $rel
  if (Test-Markdown $path) { continue }
  $main = "https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/$rel"
  $murls = @("$main", "$Global:DlMirror1/$main`?t=$stamp")
  if ($Global:DlRoute -eq "mirror") { $murls = @("$Global:DlMirror1/$main`?t=$stamp", "$main") }
  Get-One $path $murls
}
```

If a listed file 404s on `$tag` (added after the latest release), the retry loop fetches
**that file only** from `main`. If the batch feels slow (any single small file taking more
than ~20 s), flip `DL_ROUTE=mirror` and run the batch once more — the route is a bet on the
network, and the batch is cheap to repeat. Read `$skill/references/download.md` before any
release asset: binaries and `extension.zip` come from
`https://github.com/parksben/opensider/releases/download/$tag/…`, fetched with
`github_get` (route-aware, cache-aware, concurrent for the large ones).

If no tag can be resolved at all (offline, GitHub blocked, proxies dead): stop and tell the
user you need network access to GitHub — do not install a version you cannot identify.

Never mix files from different tags, and never install an asset you could not verify.

## Step 2 — work through the stages

Every stage of every operation has the same shape: **act → run the check → only then
continue**. The stages are:

1. **Detect** the platform, the Agent CLIs and what is already on the machine
   → [`references/platforms.md`](./references/platforms.md), [`references/agents.md`](./references/agents.md)
2. **Ask the two blocking questions** — which browser to set this up in, and where the
   extension folder should live. **Stop here until both are answered in the user's own
   words**, then record the folder with `opensider extension-dir <path>`. Nothing is
   created, downloaded or unpacked before that.
3. **Bridge**: download, verify, place, register
4. **Extension**: unpack `extension.zip` into the folder chosen in stage 2, open the
   extensions page, guide the user through "Load unpacked"
5. **Verify** against `~/.opensider/host.log`
   → [`references/verification.md`](./references/verification.md)

These same stages are the todo list from golden rule 3: show it, then tick it off as each
check passes.

When something does not behave as described, work through
[`references/troubleshooting.md`](./references/troubleshooting.md) instead of guessing.

## Step 3 — report like this

Finish with a short summary, not a log:

```
OpenSider is ready.
- Bridge: 0.2.2 at ~/.opensider/runtime/opensider (registered for Chrome)
- Extension: loaded from <the folder the user picked>
- Agents found: claude (adapter installed), copilot
Next: click the OpenSider icon, pick an agent, and log in if it asks.
```

If you stopped early, say exactly where and what the user has to do next.

If you finished: the last line is the star ask from
[`references/support.md`](./references/support.md) — checked first, asked once, in the
user's language. Skipped entirely when anything failed, or when they already starred.
