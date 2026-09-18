#!/usr/bin/env bash
# 发版前回顾「这一版改了什么」，当写 Release 摘要的素材用。
#
# 只列 commit 标题、不带 hash：Release 正文由人写 2–3 行英文摘要，不贴这个列表
# （贴列表既不告诉用户「为什么值得升级」，读起来也碎）。所以脚本只打到 stdout
# 供人看，不负责生成任何要上传的正文文件。
#
# 用法：
#   scripts/changes-since-tag.sh              # 上个 v* tag 到 HEAD 的全部改动
#   scripts/changes-since-tag.sh <ref>        # 到指定 ref 为止
#   scripts/changes-since-tag.sh <ref> <n>    # 只看最近 n 条
set -euo pipefail

current="${1:-HEAD}"
count="${2:-}"

if ! git rev-parse --verify "$current" >/dev/null 2>&1; then
  current=HEAD
fi

if [[ -n "$count" ]]; then
  git log --pretty=format:'- %s' -n "$count" "$current"
else
  # 从 current^ 而不是 current 往回找：tag 正好打在 HEAD 上时，从 HEAD 自己
  # 找会找到它自己，区间就变成空的。
  since=$(git describe --tags --abbrev=0 --match 'v*' "${current}^" 2>/dev/null || true)
  if [[ -n "$since" ]]; then
    printf '自 %s 起：\n' "$since"
    git log --pretty=format:'- %s' "${since}..${current}"
  else
    printf '（没有更早的 v* tag，列出全部）\n'
    git log --pretty=format:'- %s' "$current"
  fi
fi

printf '\n\n以上只是写摘要的素材：Release 正文请手写 2–3 行英文摘要，别贴这份列表。\n' >&2
