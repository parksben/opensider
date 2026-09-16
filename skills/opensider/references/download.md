# Downloading from GitHub

Every file this skill needs lives on GitHub. Do not install extra downloaders — no
aria2, no `gh`, nothing but `curl` (Windows: `curl.exe`) pointed at GitHub or at a
mirror. A mirror is a **speed trick, never a source of trust**: whichever route the
bytes took, an asset is only placed after its sha256 matches the tag's `SHA256SUMS`.

## Step 0 — pick one route for the whole run (a few seconds)

Decide `direct` or `mirror` **once**, before the first byte, and keep it for skill
files, `SHA256SUMS`, the bridge binary and `extension.zip`. Do not re-decide per
file. Switch at most once, and only when one route failed twice in a row.

| Signal | How | How to read it |
|---|---|---|
| Where this machine is (hint for you and the user) | `curl -s -o /dev/null -m 2 -w '%{http_code}' https://www.gstatic.com/generate_204`, then the same for `https://www.baidu.com` | gstatic answers fast → outside the GFW, or a proxy/VPN is already up; baidu answers fast while gstatic times out → mainland China; both fast or both slow → inconclusive, and that is fine |
| Can GitHub really deliver here (**this one decides**) | one 512 KiB Range GET of the tag's bridge binary, then the same through `https://gh-proxy.com/<original URL>` | faster side wins. GitHub under ~1 MiB/s (or failing) → `mirror`; mirror slower than GitHub → `direct`; both unusable → keep `mirror` and tell the user the network is slow |

Say the outcome out loud in one line (`GitHub 直连可用，走直连` /
`GitHub 直连超时，走国内镜像 gh-proxy.com`), and say it again if you switch mid-run.

## Cache rules (this is what keeps mirrors from handing you a stale release)

1. **Always pin the tag in the path** (`/download/<tag>/…`, `/opensider/<tag>/…`).
   A tag path is immutable, so a mirror's cached copy is a speed-up, not a risk —
   which is why the helpers below do **not** bust the cache by default: a cache miss
   means the mirror has to fetch from GitHub again, which is exactly what is slow here.
2. **Bust it in the three cases that actually go stale**: fetching `SHA256SUMS` right
   after a release, re-fetching after a checksum mismatch, and any file taken from the
   `main` branch (those really do change).
3. **How to bust**: append `?t=<unix seconds>` to the **mirror/proxy URL** only
   (`https://gh-proxy.com/https://github.com/…/SHA256SUMS?t=1758000000`). Measured on
   gh-proxy: the same URL without it is served from Cloudflare (`cf-cache-status: HIT`),
   a new `t=` forces `MISS`, and `-H 'Cache-Control: no-cache'` also turns `HIT` into
   `MISS`. On the direct route do **not** touch the GitHub URL (its redirect is signed) —
   use the `no-cache` headers instead.
4. **Cross the routes when you verify**: fetch `SHA256SUMS` over a **different** route
   than the binary (direct if the binary came from a mirror, otherwise the *other*
   mirror). Otherwise one mirror's stale `SHA256SUMS` happily validates its own stale
   binary. If the checksum mismatches, re-fetch both once with cache-busting on swapped
   routes, and only then stop and report.

## What comes from where

| What | Host | How |
|---|---|---|
| Skill markdown | `raw.githubusercontent.com`, tag-pinned | many files at once, **one GET each**. Do **not** HEAD this host (it can hang). Range is not worth it — these files are small. Mirrors: `https://gh-proxy.com/<raw url>` (also `https://ghproxy.net/<raw url>`), or `https://gcore.jsdelivr.net/gh/parksben/opensider@<tag>/skills/opensider/<rel>` — jsDelivr serves tags immutably, but do **not** use it for the `main` fallback (`@main` is cached and can hand you an old file). |
| Release assets (`SHA256SUMS`, the bridge binary, `extension.zip`) | `github.com/…/releases/download/<tag>/…` → 302 → `release-assets.githubusercontent.com` (older assets may land on `objects.githubusercontent.com`) | independent files in parallel. On the **direct** route, any single asset **≥ 1 MiB** (the ~10 MB bridge): resolve the signed CDN URL once, then **4 concurrent Range GETs** (`Accept-Ranges: bytes` → `206 Partial Content`), concatenate in order. On the **mirror** route: plain whole-file GETs only — `gh-proxy.com` does answer `206`, but `ghproxy.net` truncates sliced downloads (measured: a 1 MiB Range part came back at 322932 B), so parallel *files* yes, parallel *parts* no. |

Keep the concurrency sane. On the direct route, **4** connections per large file
(never more than 8). Track each background PID with `$!` and `wait` that PID —
`jobs -p` is often empty in a non-interactive script. If a Range assemble fails (a
part missing, or the joined size ≠ `Content-Length`), throw the parts away and do
**one** ordinary `curl -fsSL` of the original GitHub URL. On the mirror route,
parallelise **different files**, never parts of one file.

Windows: call `curl.exe` (ships with Windows 10+). The PowerShell `curl` alias is
`Invoke-WebRequest` and does not speak `--fail` / `-Z` / Range the same way.
`Start-BitsTransfer` is an optional Windows-native fallback — BITS also uses HTTP
Range under the hood, which is worth it only on the direct route.

Timeouts: `--connect-timeout 20` and `--max-time 180` on asset curls so a hung hop
cannot freeze the install (`--max-time 300` in the helpers below, because a slow
mirror hop can legitimately need longer). Never mix tags. Never place an asset you
could not hash.

## Helper (define once, then call `github_get dest <original GitHub URL>`)

macOS / Linux — paste this after the tag is pinned. It owns the route decision, the
candidate order, the cache-busting and the direct-route Range assembly:

```sh
# Two mirrors, kept in separate variables on purpose: these snippets must run under
# sh, bash AND zsh, and zsh does not word-split unquoted $var or $(...) — so never
# write `for m in $SOME_LIST`, and never loop over a $(...) result directly.
# Every helper declares its own variables with `local`: these functions call each
# other, and shells without it would clobber the caller's $dest / $url / $fresh.
DL_MIRROR_1="https://gh-proxy.com"   # answers Range; ghproxy.net truncates slices
DL_MIRROR_2="https://ghproxy.net"
DL_ROUTE=direct                       # replaced by dl_probe

# 512 KiB Range GET measured in B/s; 0 when this route cannot deliver anything.
speed_of() {
  [ -n "$1" ] || { echo 0; return; }
  "${CURL_BIN:-curl}" -s -o /dev/null -m 8 -r 0-524287 -w '%{size_download} %{time_total}' "$1" 2>/dev/null \
    | awk '{ printf "%d", ($2 > 0 ? $1 / $2 : 0) }'
}

# dl_probe <url of the big asset> — sets DL_ROUTE and prints one line you can show the user.
dl_probe() {
  local c g b d m
  c=${CURL_BIN:-curl}
  g=$("$c" -s -o /dev/null -m 2 -w '%{http_code}' https://www.gstatic.com/generate_204 2>/dev/null)
  b=$("$c" -s -o /dev/null -m 2 -w '%{http_code}' https://www.baidu.com 2>/dev/null)
  d=$(speed_of "$1")
  m=0
  if [ "${d:-0}" -lt 1048576 ]; then
    m=$(speed_of "$DL_MIRROR_1/$1")
    if [ "${m:-0}" -gt "${d:-0}" ]; then DL_ROUTE=mirror; else DL_ROUTE=direct; fi
  fi
  echo "network: gstatic=${g:-fail} baidu=${b:-fail} direct=${d:-0}B/s mirror=${m}B/s -> $DL_ROUTE"
}

# Cache-buster for mirror/proxy URLs only — a signed GitHub redirect must stay byte-identical.
dl_bust() {
  case "$1" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://api.github.com/*) printf '%s' "$1" ;;
    *) printf '%s?t=%s' "$1" "$(date +%s)" ;;
  esac
}

# One original GitHub URL -> candidates on stdout, chosen route first, the other as fallback.
dl_urls() {
  if [ "$DL_ROUTE" = mirror ]; then
    printf '%s\n%s\n%s\n' "$DL_MIRROR_1/$1" "$DL_MIRROR_2/$1" "$1"
  else
    printf '%s\n%s\n%s\n' "$1" "$DL_MIRROR_1/$1" "$DL_MIRROR_2/$1"
  fi
}

# Plain whole-file GET. Signature (url, dest, fresh) — same order as dl_get_cdn.
dl_fetch() {
  if [ "$3" = fresh ]; then
    "${CURL_BIN:-curl}" -fsSL --connect-timeout 20 --max-time 300 \
      -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' -o "$2" "$1"
  else
    "${CURL_BIN:-curl}" -fsSL --connect-timeout 20 --max-time 300 -o "$2" "$1"
  fi
}

# Direct route only: resolve the signed CDN URL, then 4-way Range assembly when ≥ 1 MiB.
# Signature (url, dest, fresh), the same as dl_fetch.
dl_get_cdn() {
  local url=$1 dest=$2 fresh=$3 c cdn size parts chunk work i pids fail start end actual
  c=${CURL_BIN:-curl}
  if [ "$fresh" = fresh ]; then
    cdn=$("$c" -fsSLI --connect-timeout 20 --max-time 60 -H 'Cache-Control: no-cache' -o /dev/null -w '%{url_effective}' "$url") || return 1
  else
    cdn=$("$c" -fsSLI --connect-timeout 20 --max-time 60 -o /dev/null -w '%{url_effective}' "$url") || return 1
  fi
  [ -n "$cdn" ] || return 1
  size=$("$c" -fsSI --connect-timeout 20 --max-time 60 -H 'Cache-Control: no-cache' "$cdn" | tr -d '\r' | awk 'tolower($1)=="content-length:" { print $2; exit }')
  if ! echo "$size" | grep -Eq '^[1-9][0-9]*$' || [ "$size" -lt 1048576 ]; then
    "$c" -fsSL --connect-timeout 20 --max-time 300 -o "$dest" "$cdn"
    return $?
  fi
  parts=4
  chunk=$(( (size + parts - 1) / parts ))
  work=$(mktemp -d)
  i=0
  pids=
  while [ "$i" -lt "$parts" ]; do
    start=$(( i * chunk ))
    end=$(( start + chunk - 1 ))
    [ "$end" -ge "$size" ] && end=$(( size - 1 ))
    "$c" -fsSL --connect-timeout 20 --max-time 300 -H "Range: bytes=$start-$end" -o "$work/p.$i" "$cdn" &
    pids=$(printf '%s\n%s' "$pids" "$!")
    i=$(( i + 1 ))
  done
  fail=0
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    wait "$p" || fail=1
  done <<EOF
$pids
EOF
  : > "$dest"
  i=0
  while [ "$i" -lt "$parts" ]; do
    [ -s "$work/p.$i" ] || fail=1
    cat "$work/p.$i" >> "$dest"
    i=$(( i + 1 ))
  done
  rm -rf "$work"
  actual=$(wc -c < "$dest" | tr -d ' ')
  [ "$fail" = 0 ] && [ "$actual" = "$size" ]
}

# github_get <dest> <original GitHub URL> [fresh] — tries the candidates in order.
github_get() {
  local dest=$1 url=$2 fresh=$3 u
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    if [ "$fresh" = fresh ]; then u=$(dl_bust "$u"); fi
    case "$u" in
      https://github.com/*/releases/download/*)
        dl_get_cdn "$u" "$dest" "$fresh" && return 0 ;;
      *)
        dl_fetch "$u" "$dest" "$fresh" && [ -s "$dest" ] && return 0 ;;
    esac
    echo "  failed: $u" >&2
  done <<EOF
$(dl_urls "$url")
EOF
  return 1
}

# Independent files at once: github_get_many "<dest> <url>" "<dest> <url>" …
github_get_many() {
  local pids= p fail=0
  while [ $# -ge 2 ]; do
    github_get "$1" "$2" &
    pids=$(printf '%s\n%s' "$pids" "$!")
    shift 2
  done
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    wait "$p" || fail=1
  done <<EOF
$pids
EOF
  return $fail
}
```

Windows (PowerShell) — `curl.exe`, not the `curl` alias. Same routing and cache
rules as above; the 512 KiB probe only needs `curl.exe`, no jobs:

```powershell
$Global:DlMirror1 = "https://gh-proxy.com"     # answers Range; ghproxy.net truncates slices
$Global:DlMirror2 = "https://ghproxy.net"
$Global:DlRoute = "direct"

function Dl-Speed {                      # 512 KiB Range GET in B/s (0 = unusable route)
  param([string]$Url)
  if ([string]::IsNullOrEmpty($Url)) { return 0 }
  $w = & curl.exe -s -o NUL -m 8 -r 0-524287 -w "%{size_download} %{time_total}" $Url
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($w)) { return 0 }
  $p = $w.Trim().Split(" ")
  if ([double]$p[1] -le 0) { return 0 }
  return [int64]([double]$p[0] / [double]$p[1])
}

function Dl-Probe {                      # Dl-Probe <url of the big asset>
  param([string]$Big)
  $g = & curl.exe -s -o NUL -m 2 -w "%{http_code}" "https://www.gstatic.com/generate_204"
  $b = & curl.exe -s -o NUL -m 2 -w "%{http_code}" "https://www.baidu.com"
  $d = Dl-Speed $Big
  $m = 0
  if ($d -lt 1MB) {
    $m = Dl-Speed ($Global:DlMirror1 + "/" + $Big)
    if ($m -gt $d) { $Global:DlRoute = "mirror" } else { $Global:DlRoute = "direct" }
  }
  Write-Host "network: gstatic=$g baidu=$b direct=$d B/s mirror=$m B/s -> $Global:DlRoute"
}

function Dl-Bust {                       # mirror/proxy URLs only, never a signed GitHub URL
  param([string]$Url)
  if ($Url -match '^https://(github\.com|raw\.githubusercontent\.com|api\.github\.com)/') { return $Url }
  return "$Url`?t=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
}

function Github-Get {
  param([string]$Dest, [string]$Url, [switch]$Fresh)
  $mirrored = @("$Global:DlMirror1/$Url", "$Global:DlMirror2/$Url")
  if ($Global:DlRoute -eq "mirror") { $cands = $mirrored + @($Url) } else { $cands = @($Url) + $mirrored }
  foreach ($u in $cands) {
    $target = $u
    if ($Fresh) { $target = Dl-Bust $u }
    if ($Fresh) {
      & curl.exe -fsSL --connect-timeout 20 --max-time 300 -H "Cache-Control: no-cache" -H "Pragma: no-cache" -o $Dest $target
    } else {
      & curl.exe -fsSL --connect-timeout 20 --max-time 300 -o $Dest $target
    }
    if ($LASTEXITCODE -eq 0 -and (Test-Path $Dest) -and (Get-Item $Dest).Length -gt 0) { return }
    Write-Host "  route failed, next candidate: $target"
  }
  throw "download failed on every route: $Url"
}
```

Both files are plain GETs (`SHA256SUMS` is tiny, the bridge is ~10 MB). On the
**direct** route the bridge can also use the native multi-connection transfer —
that is the one place where BITS still earns its keep:

```powershell
if ($Global:DlRoute -eq "direct") {
  Start-BitsTransfer -Source "$base/$asset" -Destination "$tmp\$asset"
} else {
  Github-Get $tmp\$asset "$base/$asset"      # mirror route: no Range slicing, see above
}
```

A checksum **mismatch** means "maybe a stale cache, maybe a bad mirror": re-fetch both
files once with `fresh` (cache-busting) and **swap the routes** — take `SHA256SUMS` over
the route the binary did not use, e.g. `DL_ROUTE=direct github_get "$tmp/SHA256SUMS" "$base/SHA256SUMS" fresh`.
If it still mismatches, stop: report both hashes and the routes you tried, and place
nothing. Never "fix" it by taking the hash from the same place the binary came from.

## Skill files (after the tag is pinned)

Fetch **all** of these in one parallel batch, `SKILL.md` included — the prompt handed you
that file from `main`, which raw.githubusercontent caches for minutes, so the copy you are
following can be older than the tag. Do not wait until you need each name. Each file tries
direct raw → `https://gh-proxy.com/<raw>` → jsDelivr (tag path only). A 404 on `$tag` (a file
added after the latest release) is the one case that falls back to `main` — cache-busted,
never through jsDelivr, because branch paths there are cached and can hand you an old file.

```sh
raw="https://raw.githubusercontent.com/parksben/opensider/$tag/skills/opensider"
jdel="https://gcore.jsdelivr.net/gh/parksben/opensider@$tag/skills/opensider"
skill=$(mktemp -d)
mkdir -p "$skill/references"
curl_bin=${CURL_BIN:-curl}
markdown_ok() {   # non-empty and not some proxy's HTML error page
  [ -s "$1" ] || return 1
  ! head -c 200 "$1" | grep -qiE '<!doctype|<html'
}
markdown_try() {  # markdown_try <dest> <url> … — first candidate that yields markdown wins
  dest=$1
  shift
  for u in "$@"; do
    "$curl_bin" -fsSL --connect-timeout 20 --max-time 60 -o "$dest" "$u" && markdown_ok "$dest" && return 0
  done
  : > "$dest"
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
      markdown_try "$skill/$rel" "https://gh-proxy.com/$raw/$rel" "$jdel/$rel" "$raw/$rel"
    else
      markdown_try "$skill/$rel" "$raw/$rel" "https://gh-proxy.com/$raw/$rel" "$jdel/$rel"
    fi
  ) &
done
wait   # no PID bookkeeping needed here — the per-file check below is what decides
for rel in \
  SKILL.md install.md update.md uninstall.md doctor.md \
  references/platforms.md references/download.md \
  references/agents.md references/verification.md \
  references/support.md references/troubleshooting.md
do
  if ! markdown_ok "$skill/$rel"; then
    main="https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider"
    if [ "$DL_ROUTE" = mirror ]; then
      markdown_try "$skill/$rel" "https://gh-proxy.com/$main/$rel?t=$(date +%s)" "$main/$rel"
    else
      markdown_try "$skill/$rel" "$main/$rel" "https://gh-proxy.com/$main/$rel?t=$(date +%s)"
    fi
    echo "  $rel needed the main fallback (no such file on $tag yet)" >&2
  fi
done
```

Then read `$skill/…` instead of hitting the network again. Release assets still come
from `https://github.com/parksben/opensider/releases/download/$tag/…` through
`github_get`, and they all come from the **same** tag — never from `latest/download/`,
and never from two different tags.
