# e2e visual baseline 管理策略 (Phase 3 路线, 未实现)

## 当前状态

- MR 门禁 (`e2e.yml`) 只跑 `@p0`, 不涉及视觉
- Nightly (`e2e-nightly.yml`) `--grep-invert "@visual"`, 也跳过视觉
- **repo 里没有 baseline PNG, 也没有任何 `@visual` case**

只要不打 `@visual`, 一切照常. 想开视觉基线时按下面走.

## 三个决策点

### 1. 谁能触发 baseline update

不能 `pull_request` 自动跑 — 外部 fork PR 拿不到写权限 token, push 不回去; 且不该让任意贡献者一键改视觉真相.

**方案**: `workflow_dispatch`, 只有 write 权限 collaborator 能触发, 输入参数选 PR 号或分支名.

### 2. baseline 存哪

**提交进 repo** (`apps/web/e2e-kit/screenshots/**/*.png`), 不走 artifact / LFS.

理由: 视觉基线是"视觉真相的一部分", reviewer 在 PR diff 里能看到"这次 UI 改动导致 baseline 变了什么" 才有意义. artifact 藏起来就废了.

代价: 仓库变大, PNG 二进制 diff 噪声. 后期真变大再引入 LFS.

### 3. 什么时候更 (关键)

**bootstrap + per-PR 组合**:

**Bootstrap (一次性)**: `e2e-baseline-bootstrap.yml`, `workflow_dispatch` 触发. 在 CI runner 跑 `--update-snapshots --grep "@visual"`, 生成初始 baseline commit 到 `chore/e2e-baseline-init` 分支, 开 PR 让维护者 review 后 merge. 一次搞定, 之后不用.

**Per-PR update**: `e2e-baseline-update.yml`, `workflow_dispatch` 带 `pr_number` 输入. 维护者在 PR 页 Actions tab 手动触发:

1. checkout 指定 PR 的 head branch
2. `build:e2e` → `preview:e2e`
3. `playwright test --grep "@visual" --update-snapshots`
4. **业务失败 gate**: 检查同 pipeline 里 `@p0` 是否有 business fail, 有就拒 push (避免 baseline commit 洗白业务 fail)
5. commit baseline diff, push 回 PR source branch (带 `[skip ci]`)

reviewer 在同一 PR 看到 UI + baseline 两组 diff.

## 不要做的事

- ~~自动化 baseline update on schedule~~ — baseline 应该跟着有意的 UI 改动走, 不该"自己刷新"
- ~~UI 挂了自动跑 update 洗白~~ — 业务失败 gate 就是防这个

## 打开视觉 case 的顺序

1. 先加 `@visual` case (用 `page.screenshot()` + `expect(page).toHaveScreenshot(...)`)
2. 加 `.github/workflows/e2e-baseline-bootstrap.yml`, 手动跑一次, review + merge baseline PR
3. 加 `.github/workflows/e2e-baseline-update.yml`, 之后 UI 改动 PR 里维护者手动触发
4. 打开 MR gate 的视觉判定: `e2e.yml` 的 grep 从 `"@p0"` 改成 `"@p0|@visual"`, junit 后处理已经会区分 business vs visual fail

case 文件里加 `@visual` 就够, junit 后处理逻辑不用改.

## 相关

- e2e-kit `docs/methodology/module-organization.md` — tag 层次约定
- e2e-kit `templates/e2e-init/.gitlab-ci.yml.template` — 参考里的 `e2e_visual_baseline_update` job (GitLab 版, GH Actions 版按上面策略)
