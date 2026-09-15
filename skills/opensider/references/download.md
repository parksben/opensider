# Downloading from GitHub

Every file this skill needs lives on GitHub. Use the concurrency GitHub's own
CDN already supports — do not install extra downloaders, and do not switch to
unofficial mirrors.

| What | Host | How |
|---|---|---|
| Skill markdown | `raw.githubusercontent.com` | many files at once, **one GET each**. Do **not** HEAD this host (it can hang). Range is not worth it — these files are small. |
| Release assets (`SHA256SUMS`, the bridge binary, `extension.zip`) | `github.com/…/releases/download/<tag>/…` → 302 → `release-assets.githubusercontent.com` (older assets may land on `objects.githubusercontent.com`) | independent files in parallel. Any single asset **≥ 1 MiB** (the ~10 MB bridge): resolve the signed CDN URL once, then **4 concurrent Range GETs** (`Accept-Ranges: bytes` → `206 Partial Content`), concatenate in order. |

Keep it to **4** connections per large file (never more than 8). Track each
background PID with `$!` and `wait` that PID — `jobs -p` is often empty in a
non-interactive script. If a Range assemble fails (a part missing, or the
joined size ≠ `Content-Length`), throw the parts away and do **one** ordinary
`curl -fsSL` of the original GitHub URL.

Windows: call `curl.exe` (ships with Windows 10+). The PowerShell `curl` alias
is `Invoke-WebRequest` and does not speak `--fail` / `-Z` / Range the same way.
`Start-BitsTransfer` is an optional Windows-native fallback — BITS also uses
HTTP Range under the hood.

Timeouts: `--connect-timeout 20` and `--max-time 180` on asset curls so a hung
hop cannot freeze the install. A checksum retry may add `-H 'Cache-Control: no-cache'`.

Never mix tags. Never install an asset you could not hash.

## Helper (define once, then use)

macOS / Linux — paste this, then call `github_get dest url`:

```sh
github_get() {
  dest=$1
  url=$2
  curl_bin=${CURL_BIN:-curl}
  case "$url" in
    https://github.com/*/releases/download/*) ;;
    *)
      "$curl_bin" -fsSL --connect-timeout 20 --max-time 180 -o "$dest" "$url"
      return
      ;;
  esac
  cdn=$("$curl_bin" -fsSLI --connect-timeout 20 --max-time 60 -o /dev/null -w '%{url_effective}' "$url") || {
    "$curl_bin" -fsSL --connect-timeout 20 --max-time 180 -o "$dest" "$url"
    return
  }
  size=$("$curl_bin" -fsSI --connect-timeout 20 --max-time 60 "$cdn" | tr -d '\r' | awk 'tolower($1)=="content-length:" { print $2; exit }')
  if ! echo "$size" | grep -Eq '^[1-9][0-9]*$' || [ "$size" -lt 1048576 ]; then
    "$curl_bin" -fsSL --connect-timeout 20 --max-time 180 -o "$dest" "$cdn"
    return
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
    "$curl_bin" -fsSL --connect-timeout 20 --max-time 180 -H "Range: bytes=$start-$end" -o "$work/p.$i" "$cdn" &
    pids="$pids $!"
    i=$(( i + 1 ))
  done
  fail=0
  for p in $pids; do wait "$p" || fail=1; done
  : > "$dest"
  i=0
  while [ "$i" -lt "$parts" ]; do
    [ -s "$work/p.$i" ] || fail=1
    cat "$work/p.$i" >> "$dest"
    i=$(( i + 1 ))
  done
  rm -rf "$work"
  actual=$(wc -c < "$dest" | tr -d ' ')
  if [ "$fail" != 0 ] || [ "$actual" != "$size" ]; then
    "$curl_bin" -fsSL --connect-timeout 20 --max-time 180 -o "$dest" "$url"
  fi
}

github_get_many() {
  pids=
  while [ $# -ge 2 ]; do
    dest=$1
    url=$2
    shift 2
    github_get "$dest" "$url" &
    pids="$pids $!"
  done
  fail=0
  for p in $pids; do wait "$p" || fail=1; done
  return $fail
}
```

Windows (PowerShell) — `curl.exe`, not the `curl` alias:

```powershell
function Github-Get {
  param([string]$Dest, [string]$Url)
  $curl = "curl.exe"
  if ($Url -notmatch '^https://github\.com/.+/releases/download/') {
    & $curl -fsSL --connect-timeout 20 --max-time 180 -o $Dest $Url
    if ($LASTEXITCODE -ne 0) { throw "download failed: $Url" }
    return
  }
  $cdn = & $curl -fsSLI --connect-timeout 20 --max-time 60 -o NUL -w "%{url_effective}" $Url
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($cdn)) {
    & $curl -fsSL --connect-timeout 20 --max-time 180 -o $Dest $Url
    return
  }
  $hdr = & $curl -fsSI --connect-timeout 20 --max-time 60 $cdn
  $size = 0
  foreach ($line in $hdr) {
    if ($line -match '(?i)^content-length:\s*(\d+)') { $size = [int64]$Matches[1]; break }
  }
  if ($size -lt 1MB) {
    & $curl -fsSL --connect-timeout 20 --max-time 180 -o $Dest $cdn
    return
  }
  $parts = 4
  $chunk = [int64][math]::Ceiling($size / $parts)
  $work = Join-Path $env:TEMP ("opensider-dl-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Force $work | Out-Null
  $jobs = @()
  for ($i = 0; $i -lt $parts; $i++) {
    $start = $i * $chunk
    $end = [math]::Min($start + $chunk - 1, $size - 1)
    $part = Join-Path $work "p.$i"
    $jobs += Start-Job -ScriptBlock {
      param($curl, $cdn, $start, $end, $part)
      & $curl -fsSL --connect-timeout 20 --max-time 180 -H "Range: bytes=$start-$end" -o $part $cdn
      if ($LASTEXITCODE -ne 0) { throw "range $start-$end failed" }
    } -ArgumentList $curl, $cdn, $start, $end, $part
  }
  $jobs | Wait-Job | Out-Null
  $ok = -not ($jobs | Where-Object { $_.State -ne 'Completed' })
  $out = [System.IO.File]::Create($Dest)
  for ($i = 0; $i -lt $parts; $i++) {
    $part = Join-Path $work "p.$i"
    if (-not (Test-Path $part) -or (Get-Item $part).Length -le 0) { $ok = $false; break }
    $bytes = [System.IO.File]::ReadAllBytes($part)
    $out.Write($bytes, 0, $bytes.Length)
  }
  $out.Close()
  Remove-Item -Recurse -Force $work
  if (-not $ok -or (Get-Item $Dest).Length -ne $size) {
    & $curl -fsSL --connect-timeout 20 --max-time 180 -o $Dest $Url
  }
}

# SHA256SUMS is tiny — call Github-Get on it, then Github-Get on the binary
# (the binary helper is already 4-way parallel). Optional BITS fallback:
#   Start-BitsTransfer -Source $url -Destination $dest
```

A checksum mismatch retry uses the same helper plus `-H 'Cache-Control: no-cache'`
(pass it through on the fallback `curl` line, or just run one no-cache GET of
both files in parallel).

## Skill files (after the tag is pinned)

Fetch **all** of these in one parallel batch. Do not wait until you need each
name. If a path 404s on `$tag` (a file added after the latest release), retry
**that file only** from `main`.

```sh
raw="https://raw.githubusercontent.com/parksben/opensider/$tag/skills/opensider"
skill=$(mktemp -d)
mkdir -p "$skill/references"
curl_bin=${CURL_BIN:-curl}
pids=
for rel in \
  install.md update.md uninstall.md doctor.md \
  references/platforms.md references/download.md \
  references/agents.md references/verification.md \
  references/troubleshooting.md
do
  "$curl_bin" -fsSL --connect-timeout 20 --max-time 60 -o "$skill/$rel" "$raw/$rel" &
  pids="$pids $!"
done
fail=0
for p in $pids; do wait "$p" || fail=1; done
# any empty / missing file: retry that one from main
main="https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider"
for rel in \
  install.md update.md uninstall.md doctor.md \
  references/platforms.md references/download.md \
  references/agents.md references/verification.md \
  references/troubleshooting.md
do
  if [ ! -s "$skill/$rel" ]; then
    "$curl_bin" -fsSL --connect-timeout 20 --max-time 60 -o "$skill/$rel" "$main/$rel" || true
  fi
done
```

Then read `$skill/…` instead of hitting the network again. Release assets still
come from `https://github.com/parksben/opensider/releases/download/$tag/…`.
