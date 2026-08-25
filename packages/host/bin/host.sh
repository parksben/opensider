#!/bin/bash
set -euo pipefail

export HOME="${HOME:-$HOME}"
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

mkdir -p "${HOME}/.cursor-sidebar"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) launch pid=$$" >> "${HOME}/.cursor-sidebar/host.log"

HOST_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HOST_DIR"

if [[ -n "${CURSOR_SIDEBAR_NODE:-}" ]]; then
  exec "${CURSOR_SIDEBAR_NODE}" --experimental-strip-types src/index.ts
fi

exec node --experimental-strip-types src/index.ts
