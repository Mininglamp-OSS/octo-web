# Reports 占位

kit **不碰**本目录. 本 README (由 sync 首次生成) 可以留作占位, 但**实际 report 产物**（`aggregate.md` / `<CaseId>-test-report.md` / `keyframes/*.png` / `traces/*.zip`）**不进 git** —— 目标 repo `.gitignore` 应加 `e2e/reports/*/` 排除产物, 但保留 `e2e/reports/README.md`.

## 两级 report 结构

```
reports/<feature-slug>-<TS>/
├── aggregate.md            # 顶层汇总: 所有 case 一张表 + coverage 矩阵 + notes
├── aggregate.csv           # 机读格式(供 CI / 跨 run 对比)
├── C7-test-report.md       # per-case 详情: 10x 稳定性 / trace / keyframes / 失败截图
├── C8-test-report.md
├── keyframes/
│   ├── C7/*.png
│   └── C8/*.png
├── traces/
│   ├── C7.zip
│   └── C8.zip
└── traces-all.tar.gz       # 一次发全用
```

## 生成

PR-2 提供 `e2e/_kit/scripts/collect-evidence.sh` 从 Playwright json reporter 一把梭生成 aggregate + per-case + 提取 keyframes/traces.

sync 策略: **hands_off** (且 `.gitignore` 内).
