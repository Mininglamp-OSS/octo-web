#!/usr/bin/env bash
set -euo pipefail

# Run one case through the kit stability gate.
# Usage: apps/web/e2e-kit/_lib/verify-case.sh --grep='@C7' [--config=/path/to/playwright.ci.config.ts]

GREP=""
CONFIG=""
REPEAT_EACH="3"
EXTRA=()
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

while [ "$#" -gt 0 ]; do
  arg="$1"
  shift
  case "$arg" in
    --grep=*) GREP="${arg#*=}" ;;
    --config=*) CONFIG="${arg#*=}" ;;
    --repeat-each=*) REPEAT_EACH="${arg#*=}" ;;
    --) EXTRA+=("$@"); break ;;
    *) EXTRA+=("$arg") ;;
  esac
done

if [ -z "$GREP" ]; then
  echo "缺少 --grep=<case tag>，例如 --grep='@C7'" >&2
  exit 2
fi

if [ -z "$CONFIG" ]; then
  CONFIG="$E2E_ROOT/playwright.ci.config.ts"
fi
CMD=(pnpm exec playwright test --grep "$GREP" --repeat-each="$REPEAT_EACH" --workers=1 --config "$CONFIG")
if [ "${#EXTRA[@]}" -gt 0 ]; then
  CMD+=("${EXTRA[@]}")
fi

echo "[e2e verify] ${CMD[*]}"
"${CMD[@]}"
echo "[e2e verify] $GREP: ${REPEAT_EACH}/${REPEAT_EACH} runs passed"
