#!/usr/bin/env bash
# spec-history.sh — 追溯某个 case-spec 的修改历史
#
# 用法:
#   e2e/_lib/spec-history.sh <caseId>
#
# 例:
#   e2e/_lib/spec-history.sh C7
#   → 输出 git log --oneline -- e2e/case-specs/C7-*.md
#
# 为什么用脚本而不在 md 头部写 commit hash:
# - commit hash 手工回填累人且易漏, 直接用 git 命令查更准
# - 一个 case-spec 演进多次, log 一览无遗

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 <caseId>" >&2
  echo "例:   $0 C7   → 查 e2e/case-specs/C7-*.md 修改历史" >&2
  exit 2
fi

case_id="$1"
# 相对目标 repo root 跑
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
spec_glob="${repo_root}/e2e/case-specs/${case_id}-*.md"

# glob 展开检查
if ! ls $spec_glob >/dev/null 2>&1; then
  echo "未找到匹配的 case-spec: ${spec_glob}" >&2
  echo "提示: 确认 caseId 大小写 (C7 vs c7) 且 spec 已 git add" >&2
  exit 1
fi

# git log --follow 追 rename 历史; --oneline 简洁; -- <path> 隔离
git -C "$repo_root" log --oneline --follow -- "e2e/case-specs/${case_id}-"*.md
