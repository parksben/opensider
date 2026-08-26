#!/bin/bash

export HOME="${HOME:-$HOME}"
export PATH="/bin:/usr/bin:${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

mkdir -p "${HOME}/.opensider" /tmp
{
  echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) launch pid=$$"
} >> "${HOME}/.opensider/host.log" 2>/dev/null || true
{
  echo "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) launch pid=$$"
} >> /tmp/opensider-host.log 2>/dev/null || true

HOST_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HOST_DIR"

if [[ -n "${OPENSIDER_NODE:-}" ]]; then
  exec "${OPENSIDER_NODE}" --experimental-strip-types src/index.ts
fi

exec node --experimental-strip-types src/index.ts
