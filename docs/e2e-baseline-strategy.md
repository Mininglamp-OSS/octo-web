# e2e visual baseline 管理策略 (Phase 3 路线, 未实现)

## 当前状态

- MR 门禁 (`e2e.yml`) 跑 `@p0|@visual`, 业务 fail block，visual-only fail 由后处理 allow 并提示更新 baseline
- Nightly (`e2e-nightly.yml`) 跑 `@p[0-9]|@visual`, 不再排除视觉 case
- repo 里已有少量独立 `@visual` case, 但还没有 baseline PNG
- 初次 bootstrap 和后续 per-PR update 都通过 `workflow_dispatch` 手动触发

baseline PNG 合入前，PR gate 可以先暴露 visual diff 但不因 visual-only fail 阻断；nightly 跑全量用于尽早发现视觉漂移。

## 三个决策点

### 1. 谁能触发 baseline update

不能 `pull_request` 自动跑 — 外部 fork PR 拿不到写权限 token, push 不回去; 且不该让任意贡献者一键改视觉真相.

**方案**: `workflow_dispatch`, 只有 write 权限 collaborator 能触发, 输入参数选 PR 号或分支名.

### 2. baseline 存哪

**提交进 repo** (`apps/web/e2e-kit/screenshots/**/*.png`), 不走 artifact / LFS.

但 `apps/web/e2e-kit/screenshots/` 仍保留在 `.gitignore`，防止开发者本地跑 `--update-snapshots` 后误提交。bootstrap/update workflow 用 `git add -f apps/web/e2e-kit/screenshots/` 显式加入 baseline PNG。

理由: 视觉基线是"视觉真相的一部分", reviewer 在 PR diff 里能看到"这次 UI 改动导致 baseline 变了什么" 才有意义. artifact 藏起来就废了.

代价: 仓库变大, PNG 二进制 diff 噪声. 后期真变大再引入 LFS.

### 3. 什么时候更 (关键)

**bootstrap + per-PR 组合**:

**Bootstrap (一次性)**: `.github/workflows/e2e-baseline-bootstrap.yml`, `workflow_dispatch` 触发. 在 CI runner 跑 `--update-snapshots --grep "@visual"`, 再跑一次 `@visual` verify, 生成初始 baseline commit 到 `chore/e2e-baseline-init` 分支, 开 PR 让维护者 review 后 merge. 一次搞定, 之后不用.

**Per-PR update**: `.github/workflows/e2e-baseline-update.yml`, `workflow_dispatch` 带 `pr_number` 输入. 维护者在 Actions tab 手动触发:

1. checkout 指定 PR 的 head branch（仅支持同仓库分支 PR, fork PR 不回写 baseline）
2. `build:e2e` → `playwright test --grep "@p0"`
3. **业务失败 gate**: `@p0` 必须真执行且通过 (`tests >= EXPECTED_P0`, `skipped=0`, 无 proxy error), 有业务失败就拒 push
4. `playwright test --grep "@visual" --update-snapshots`
5. 再跑一次 `@visual` verify, 无 proxy error 后 commit baseline diff
6. push 回 PR source branch (带 `[skip ci]`)

reviewer 在同一 PR 看到 UI + baseline 两组 diff.

## 不要做的事

- ~~自动化 baseline update on schedule~~ — baseline 应该跟着有意的 UI 改动走, 不该"自己刷新"
- ~~UI 挂了自动跑 update 洗白~~ — 业务失败 gate 就是防这个

## 打开视觉 case 的顺序

1. 已加少量独立 `@visual` case (例如 `@C1v`, `@C3v`), 不打 `@p0`
2. MR gate 已跑 `@p0|@visual`；visual-only fail 不阻断，但会在日志里提示需要更新 baseline
3. Nightly 已跑 `@p[0-9]|@visual`，不再排除视觉 case
4. 手动触发 `.github/workflows/e2e-baseline-bootstrap.yml`, review + merge baseline PR
5. 后续 UI 改动 PR 需要刷新视觉真相时, 手动触发 `.github/workflows/e2e-baseline-update.yml` 并传 `pr_number`

case 文件里加 `@visual` 就够, junit 后处理逻辑不用改.

## 相关

- e2e-kit `docs/methodology/module-organization.md` — tag 层次约定
- e2e-kit `templates/e2e-init/.gitlab-ci.yml.template` — 参考里的 `e2e_visual_baseline_update` job (GitLab 版, GH Actions 版按上面策略)
