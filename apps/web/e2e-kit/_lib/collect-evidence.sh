#!/usr/bin/env bash
# collect-evidence.sh — 从 Playwright json reporter 一把梭生成两级 report + trace/keyframes 打包
#
# 用法 (在目标 repo 根目录):
#   e2e/_lib/collect-evidence.sh --feature=<slug> [--target-dir=e2e]
#
# 前置:
#   1. 已跑过 `pnpm exec playwright test --grep @<CaseId>` 且 playwright.config.ts
#      配了 json reporter 输出到 `e2e/reports/.raw-results.json` (kit v0.1 默认已配)
#   2. 稳定性 10x 也 OK: --repeat-each=10, tests[*].results 会有 10 条
#
# 产出:
#   e2e/reports/<feature>-<TS>/
#     ├── aggregate.md           顶层汇总
#     ├── aggregate.csv          机读格式
#     ├── <CaseId>-test-report.md 每 case 详情
#     ├── keyframes/<CaseId>/*.png
#     ├── traces/<CaseId>.zip
#     └── traces-all.tar.gz
#
# 详见 kit repo docs/methodology/two-tier-report.md

set -euo pipefail

# ---- 参数 ------------------------------------------------------------------
FEATURE=""
TARGET_DIR="e2e"

for arg in "$@"; do
  case "$arg" in
    --feature=*) FEATURE="${arg#*=}" ;;
    --target-dir=*) TARGET_DIR="${arg#*=}" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "未知参数: $arg (--help 查看)" >&2; exit 2 ;;
  esac
done

if [ -z "$FEATURE" ]; then
  echo "缺少 --feature=<slug>. 例: --feature=create-category" >&2
  exit 2
fi

# ---- 路径 ------------------------------------------------------------------
REPO_ROOT="$(pwd)"
RAW_JSON="$REPO_ROOT/$TARGET_DIR/reports/.raw-results.json"
TEST_RESULTS_DIR="$REPO_ROOT/$TARGET_DIR/test-results"

if [ ! -f "$RAW_JSON" ]; then
  echo "找不到 Playwright json reporter 产物: $RAW_JSON" >&2
  echo "  确认已跑过 playwright test 且 config 里配了 json reporter" >&2
  exit 3
fi

TS=$(date +%Y%m%d-%H%M)
REPORT_DIR="$REPO_ROOT/$TARGET_DIR/reports/${FEATURE}-${TS}"
mkdir -p "$REPORT_DIR/keyframes" "$REPORT_DIR/traces"

echo "[collect-evidence] feature=$FEATURE ts=$TS"
echo "  raw: $RAW_JSON"
echo "  out: $REPORT_DIR"

# ---- Python 解析 raw-results.json → aggregate.md/csv + per-case md ---------
# bash 处理 JSON 太烧脑, 用 python (stdlib 够, 无第三方依赖).
export REPORT_DIR RAW_JSON TEST_RESULTS_DIR FEATURE TS
python3 <<'PY'
import json
import os
import re
import shutil
import statistics
import sys
from pathlib import Path

report_dir = Path(os.environ["REPORT_DIR"])
raw_json = Path(os.environ["RAW_JSON"])
test_results_dir = Path(os.environ["TEST_RESULTS_DIR"])
feature = os.environ["FEATURE"]
ts = os.environ["TS"]

data = json.loads(raw_json.read_text())

def walk_specs(node):
    for s in node.get("specs", []):
        yield s
    for sub in node.get("suites", []):
        yield from walk_specs(sub)

# 汇总: {case_id: {title, runs: [{duration_ms, status}, ...], spec_file}}
cases = {}
for suite in data.get("suites", []):
    for spec in walk_specs(suite):
        # spec.title 通常形如 "@C7 create-category — desc"; case_id 是首 token @<xxx>
        title = spec.get("title", "")
        m = re.match(r"@(\S+)", title)
        case_id = m.group(1) if m else title.split(" ")[0]
        spec_file = spec.get("file", "")
        runs = []
        for t in spec.get("tests", []):
            for r in t.get("results", []):
                runs.append({
                    "duration_ms": r.get("duration", 0),
                    "status": r.get("status", "unknown"),
                    "attachments": r.get("attachments", []),
                })
        cases[case_id] = {"title": title, "runs": runs, "spec_file": spec_file}

if not cases:
    print("[warn] 没解出任何 case, 检查 --grep 是否命中 + spec title 是否 @<CaseId> 开头", file=sys.stderr)

# 拷 trace + keyframes: 从 test-results/<caseFsName>/{trace.zip,*.png} 拷到 REPORT_DIR
# Playwright test-results/ 命名: <specFile-stem>-<Case-fs-name>[-repeat-N]/
def find_case_first_run_dir(case_id):
    """从 test-results/ 里找该 case 的第一次运行目录 (无 -repeat 后缀)."""
    if not test_results_dir.exists():
        return None
    # 简单启发式: 目录名含 case_id, 无 '-repeat'
    for p in sorted(test_results_dir.iterdir()):
        if p.is_dir() and case_id.lower() in p.name.lower() and "-repeat" not in p.name:
            return p
    return None

for case_id in cases:
    first_run = find_case_first_run_dir(case_id)
    if not first_run:
        continue
    trace = first_run / "trace.zip"
    if trace.exists():
        shutil.copy(trace, report_dir / "traces" / f"{case_id}.zip")
    kf_dir = report_dir / "keyframes" / case_id
    kf_dir.mkdir(exist_ok=True)
    for png in first_run.glob("*.png"):
        shutil.copy(png, kf_dir)

# ---- aggregate.md ---------------------------------------------------------
def stats(runs):
    durs = [r["duration_ms"] for r in runs if r["status"] == "passed"]
    n_pass = len(durs)
    n_total = len(runs)
    if not durs:
        return {"pass": n_pass, "total": n_total, "avg": 0, "min": 0, "max": 0, "stddev": 0}
    return {
        "pass": n_pass,
        "total": n_total,
        "avg": statistics.mean(durs) / 1000,
        "min": min(durs) / 1000,
        "max": max(durs) / 1000,
        "stddev": statistics.stdev(durs) / 1000 if len(durs) > 1 else 0,
    }

agg_md = report_dir / "aggregate.md"
lines = []
lines.append(f"# {feature} E2E Report")
lines.append("")
lines.append(f"- Generated: {ts}")
lines.append(f"- Feature: {feature}")
lines.append("- Runtime: 从 raw-results.json 无法拿到 node/pnpm 版本, 手工补")
lines.append("")
lines.append("## Cases")
lines.append("")
lines.append("| CaseId | Status | Avg time (with trace) | Notes |")
lines.append("|---|---|---|---|")
for case_id, info in cases.items():
    s = stats(info["runs"])
    if s["pass"] == s["total"] and s["total"] > 0:
        status_str = f"✅ pass ({s['pass']}/{s['total']})"
    elif s["pass"] < s["total"] and s["pass"] > 0:
        status_str = f"⚠️ flake ({s['pass']}/{s['total']})"
    else:
        status_str = f"❌ fail ({s['pass']}/{s['total']})"
    avg_str = f"{s['avg']:.2f}s (min {s['min']:.2f}, max {s['max']:.2f}, stddev {s['stddev']:.2f})" if s["total"] > 0 else "—"
    lines.append(f"| @{case_id} | {status_str} | {avg_str} | — |")
lines.append("")
lines.append("## Coverage vs Requirements")
lines.append("")
lines.append("<!-- TODO 手工填 -->")
lines.append("")
lines.append("| Req / AC | Covered by | Status |")
lines.append("|---|---|---|")
lines.append("")
lines.append("## Notes / 已知限制")
lines.append("")
lines.append("<!-- TODO 手工填 -->")
agg_md.write_text("\n".join(lines) + "\n")

# ---- aggregate.csv --------------------------------------------------------
agg_csv = report_dir / "aggregate.csv"
csv_lines = ["case_id,status,pass_count,total_runs,avg_ms,min_ms,max_ms,stddev_ms"]
for case_id, info in cases.items():
    s = stats(info["runs"])
    st = "pass" if s["pass"] == s["total"] and s["total"] > 0 else ("flake" if s["pass"] > 0 else "fail")
    csv_lines.append(f"{case_id},{st},{s['pass']},{s['total']},{s['avg']*1000:.0f},{s['min']*1000:.0f},{s['max']*1000:.0f},{s['stddev']*1000:.0f}")
agg_csv.write_text("\n".join(csv_lines) + "\n")

# ---- per-case md ----------------------------------------------------------
for case_id, info in cases.items():
    s = stats(info["runs"])
    pc = report_dir / f"{case_id}-test-report.md"
    lines = []
    lines.append(f"# @{case_id} {info['title'][len(case_id)+1:].strip()} — Test Report")
    lines.append("")
    lines.append(f"- Feature: {feature}")
    lines.append(f"- Spec: [../case-specs/{case_id}-*.md]")
    lines.append(f"- Runs: {s['pass']} / {s['total']} pass")
    if s["total"] > 0:
        lines.append(f"- Avg: {s['avg']:.2f}s (min {s['min']:.2f}, max {s['max']:.2f}, stddev {s['stddev']:.2f}) (with trace overhead)")
    lines.append("")
    lines.append("## Runs")
    lines.append("")
    lines.append("| # | duration | status |")
    lines.append("|---|---|---|")
    for i, r in enumerate(info["runs"], 1):
        icon = "✅" if r["status"] == "passed" else "❌"
        lines.append(f"| {i} | {r['duration_ms']/1000:.2f}s | {icon} {r['status']} |")
    lines.append("")
    lines.append("## Trace")
    lines.append("")
    trace_p = report_dir / "traces" / f"{case_id}.zip"
    if trace_p.exists():
        lines.append(f"- `traces/{case_id}.zip` — `pnpm exec playwright show-trace <path>`")
    else:
        lines.append("- (trace 未采集; 确认 playwright.config.ts trace=retain-on-failure or on)")
    lines.append("")
    lines.append("## Keyframes")
    lines.append("")
    kf_dir = report_dir / "keyframes" / case_id
    pngs = sorted(kf_dir.glob("*.png")) if kf_dir.exists() else []
    if pngs:
        for png in pngs:
            lines.append(f"- `keyframes/{case_id}/{png.name}`")
    else:
        lines.append("- (未采集; 确认 playwright.config.ts screenshot=on or only-on-failure)")
    pc.write_text("\n".join(lines) + "\n")

print(f"✓ 生成: {agg_md.name} / {agg_csv.name} / {len(cases)} 份 per-case md")
PY

# ---- 打包 traces-all.tar.gz ------------------------------------------------
if [ -n "$(ls -A "$REPORT_DIR/traces" 2>/dev/null)" ]; then
  tar czf "$REPORT_DIR/traces-all.tar.gz" -C "$REPORT_DIR" traces/
  echo "  ✓ traces-all.tar.gz 打包 ($(du -h "$REPORT_DIR/traces-all.tar.gz" | awk '{print $1}'))"
else
  echo "  ⚠ 无 trace 采集, 跳过 tar.gz 打包"
fi

echo ""
echo "✓ 证据包生成完成: $REPORT_DIR"
echo "  编辑 aggregate.md 里的 Coverage / Notes 段后即可交付."
