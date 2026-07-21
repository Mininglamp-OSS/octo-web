# Case specs 占位

kit **不碰**本目录, 只在首次 sync 时建目录 + 放本 README + `TEMPLATE.md`.

## 起草新 case-spec

```bash
cp e2e/case-specs/TEMPLATE.md e2e/case-specs/C7-my-feature.md
$EDITOR e2e/case-specs/C7-my-feature.md
```

按 7 段结构填 (详见 `TEMPLATE.md` + kit repo 的 [docs/methodology/case-spec-guide.md](https://codex.mlamp.cn/e2e/e2e-kit/-/blob/main/docs/methodology/case-spec-guide.md), PR-2 落).

## 命名规范

- 格式: `<CaseId>-<kebab-name>.md`
- CaseId 前缀:
  - `C<n>` — Core / 主流程
  - `S<n>` — Secondary / 边界
  - `U<n>` — UI 组件契约（走 harness route）
  - `P<n>` — Perf / 性能相关
  - 项目自定义前缀允许 (grep 一下别撞就行)

## 追溯 case-spec 修改历史

不写文档里的 commit hash. 用 helper:

```bash
e2e/_lib/spec-history.sh C7
# 等价于 git log --oneline -- e2e/case-specs/C7-*.md
```

sync 策略: **hands_off** (kit 完全不碰).
