# RB2 删除有待审申请的连接器后组织发布管理徽标立即归零

## Metadata

- Case 类型: 回归守护
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@RB2 @p1 @mcp @market @review`

## 目标

验证删除一个「有待审申请」的连接器之后，侧边栏「组织发布管理」上的待审计数徽标在同一页面实例内立即归零，不需要刷新页面。

RB1 守护的是「做出审核决策」这条路径；本 case 守护另一条让申请离开队列的路径——**承载它的插件被删掉了**。这条路径此前没有被覆盖，因为连接器 / 专家的删除走 dmworkmcp 自己的 api 模块（`mcpService` / `expertService`），而不是 `@dmwork/skillmarket` 的 `deleteSkill`，于是它可以在无人察觉的情况下与后者失去对称。

## 后端前提（已在 octo-marketplace 侧核实）

删除插件会在**同一事务**内把它上面 pending 的审核申请 cancel 掉
（`internal/repository/plugin/review.go` 的 `cancelPendingReviewFor`，reason
`plugin deleted`；由 `write.go:476/665/732` 调用，`internal/db/plugin_delete_cascade_test.go`
的 `TestDeleteCancelsThePendingReviewRequest` 钉住）。

原因是删除之后那条申请**两个方向都不可达**：所有读取（`ListReviewRequests` /
`GetReviewRequest` / `LoadReviewSnapshot`）都带 `p.deleted_at IS NULL`，申请人和
审核人都看不见它；而所有决策路径都经 `getReviewedPluginForUpdate` 加载插件，会拒绝
已删除的插件。所以只有删除所在的那个事务能了结它。

也正因为服务端计数**确实**会掉，客户端不重新读取才会被用户看见。

## 前置条件

- fixture: `fixtures-authed`；mock 用户在 `e2e-space-001` 中 `role: 1`（owner），可见 reviewer 专属入口。
- Per-case MSW handler: `e2e-kit/msw-handlers/rb2-connector-delete-review.ts`，
  用 C40 的运行时 `window.__msw.worker.use` 方式安装。
  - `GET /market/api/v1/plugins`（`mode=mine&plugin_type=connector`）— 未删除时返回该连接器。
  - `GET /market/api/v1/plugins/review_requests` — 未删除时返回 1 条 pending。
  - `POST /market/api/v1/plugins/delete` — 置 `deleted=true`，**同时**影响上面两个读。
  - handler 必须是有状态的：如果 `total` 恒为 1，无论徽标是否重新拉取断言都会通过；
    如果恒为 0，修复前也会通过。这一个 `deleted` 布尔量同时驱动列表和队列，正是模拟
    后端的级联。

## 用户操作步骤

1. 打开 `/mcp-market/mine?type=mcp`（我的发布 → 连接器）。
2. 确认侧边栏「组织发布管理」行上的徽标显示 `1`。
3. 点击该行的「删除「待审连接器」」，在确认弹窗里点「删除」。
4. 不刷新、不跳转，直接观察侧边栏。

## 预期结果

- 删除前，侧边栏「组织发布管理」行的 `.wk-mcp-sidebar__badge` 文本为 `1`。
- 删除后，表格里该行消失。
- 同一页面实例内，侧边栏徽标消失（计数归零时整个徽标不渲染）。

## 反例

- 修复前实测：行消失了，徽标停在 `1` 十秒不动 —— 侧边栏在为一个**已经不存在的连接器**
  显示待审申请。
- 如果把失效逻辑挂在调用点而不是接口上，`McpDeleteConfirmModal` 和 `McpDetailModal`
  两处都要各自记得刷新，下一个删除入口（批量操作、快捷键）还会再漏一次。
- 如果只包 `deleteMcp` 而不包 `deleteExpert` / `deleteSquad`，专家侧同样的缺陷会留下；
  三者由 `packages/dmworkmcp/src/api/pluginDelete.reviewInvalidation.test.ts` 一起钉住。

## 视觉基准

不建 pixel baseline；用 `getByRole` 定位侧边栏行与表格行，再用 `.wk-mcp-sidebar__badge`
类选择器断言计数存在与消失。

## 摸清依据

- `packages/dmworkmcp/src/api/mcpService.ts`: `deleteMcp` 的 `withReviewInvalidation` 包裹。
- `packages/dmworkmcp/src/api/expertService.ts`: `deleteExpert` / `deleteSquad` 同上。
- `packages/dmworkskillmarket/src/api/skillApi.ts`: `deleteSkill` 早已如此包裹——本 case 修的就是这个不对称。
- `packages/dmworkskillmarket/src/api/reviewSignal.ts`: 为什么失效挂在接口而不是调用点上。
- `packages/dmworkmcp/src/components/MarketSidebar.tsx`: `<ReviewGateProbe />` 的徽标读取。
