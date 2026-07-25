# Baseline MSW handler 占位

本目录 PR-2 抽 auth guard 依赖的 baseline handler.

**预计放** (基于 octo-web-2 e2e-research/playwright 的 shared/msw-handlers/auth.ts):
- `appconfig.ts` — GET /v1/common/appconfig baseline (全字段 spread)
- `space.ts` — GET /v1/space/my
- `users.ts` — GET /v1/users/:uid & /users/:uid/im

**关键规范**:
- baseline handler 必须**全字段 spread**, 别只返 case 关心的字段. auth guard 依赖 `oidc_providers / system_bot_uids` 等, 缺就走 undefined 分支踢登录页
- 接入方 case 需要覆写 baseline 时, spread 全字段 + 叠差异, 不能只叠差异

`applyResearchRoutes(page)` 只装本目录 handler, 不装 `msw-handlers/<caseId>-*.ts` (case handler 显式装).

sync 策略: **overwrite**.
