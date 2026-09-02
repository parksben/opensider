#!/usr/bin/env bash
# Thin user installer: download the matching OpenSider binary from GitHub
# releases/latest, verify SHA-256, then exec `opensider install`.
set -euo pipefail

REPO_DOWNLOAD="https://github.com/parksben/cursor-sidebar/releases/latest/download"

die() {
  echo "opensider install: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "need '$1' on PATH"
}

need_cmd curl
need_cmd uname
need_cmd mktemp

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  darwin | linux) ;;
  mingw* | msys* | cygwin*)
    die "unsupported OS '$os' (use install.ps1 on Windows)"
    ;;
  *)
    die "unsupported OS '$os' (need darwin or linux)"
    ;;
esac

arch="$(uname -m)"
case "$arch" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=amd64 ;;
  *)
    die "unsupported architecture '$arch' (need arm64 or amd64)"
    ;;
esac

name="opensider-${os}-${arch}"

work="$(mktemp -d "${TMPDIR:-/tmp}/opensider-install.XXXXXX")"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

cd "$work"
curl -fsSL -o SHA256SUMS "${REPO_DOWNLOAD}/SHA256SUMS" \
  || die "failed to download SHA256SUMS"
curl -fsSL -o "$name" "${REPO_DOWNLOAD}/${name}" \
  || die "failed to download ${name}"

expected="$(awk -v n="$name" '
  $2 == n || $2 == ("*" n) { print $1; found = 1 }
  END { if (!found) exit 1 }
' SHA256SUMS)" || die "${name} is not listed in SHA256SUMS"

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$name" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$name" | awk '{ print $1 }')"
else
  die "need sha256sum or shasum to verify the download"
fi

if [[ "$actual" != "$expected" ]]; then
  die "SHA256 mismatch for ${name} (expected ${expected}, got ${actual})"
fi

chmod +x "$name"
trap - EXIT
exec "./${name}" install
