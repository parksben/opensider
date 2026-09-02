#!/usr/bin/env bash
# Print markdown commit list from the previous v* tag (or repo root) to
# the current tag / HEAD. No product blurb.
set -euo pipefail

current="${1:-${GITHUB_REF_NAME:-HEAD}}"

if ! git rev-parse --verify "$current" >/dev/null 2>&1; then
  current=HEAD
fi

current_tag=""
if current_tag="$(git describe --tags --exact-match "$current" 2>/dev/null)"; then
  prev="$(git tag -l 'v*' --sort=-v:refname | awk -v cur="$current_tag" '$0 != cur { print; exit }')"
else
  prev="$(git tag -l 'v*' --sort=-v:refname | head -n1)"
fi

if [[ -n "${prev:-}" ]]; then
  git log --pretty=format:'- %h %s' "${prev}..${current}"
else
  git log --pretty=format:'- %h %s' "$current"
fi
printf '\n'
