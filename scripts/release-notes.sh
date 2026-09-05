#!/usr/bin/env bash
# Print the last 3 commits as a markdown list. No product blurb.
set -euo pipefail

current="${1:-${GITHUB_REF_NAME:-HEAD}}"
limit="${2:-3}"

if ! git rev-parse --verify "$current" >/dev/null 2>&1; then
  current=HEAD
fi

git log --pretty=format:'- %h %s' -n "$limit" "$current"
printf '\n'
