# RB1 组织发布管理徽标在审核决策后立即更新

## Metadata

- Case 类型: 回归守护
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@RB1 @p1 @skills @market @review`

## 目标

验证侧边栏「组织发布管理」入口上的待审核计数徽标，在同一页面实例内做出审核决策后立即更新，不需要刷新页面。

徽标和「待审核」列表是同一个队列的两次独立读取——徽标必须在 `ReviewQueue` 未挂载时（用户停留在技能 / 连接器 / 我的发布）也能显示计数，所以它无法从列表状态派生。二者共享的只能是「何时同时失效」这一时刻，而这个时刻是审核类写操作本身。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime；mock 用户在 `e2e-space-001` 中 `role: 1`（owner），因此可见 reviewer 专属入口。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "skill-market-review-badge"`，并清除 `__e2e_rb1_loaded`，启用本 case 的 MSW handler 并重置其队列状态。
- Per-case MSW handler: `e2e-kit/msw-handlers/skill-market-review-badge.ts`
  - `GET /market/api/v1/plugins/review_requests` — 有状态：初始返回 1 条 pending 记录。
  - `POST /market/api/v1/plugins/review_requests/:id/approve` — 把该记录从 pending 移到 approved；重复调用返回 409。
  - handler 必须是有状态的：如果 `total` 恒为 1，无论徽标是否重新拉取断言都会通过，用例就失去意义。

## 用户操作步骤

1. 打开 `/mcp-market/review`（组织发布管理）。
2. 确认侧边栏「组织发布管理」行上的徽标显示 `1`。
3. 在待审核列表里点击该行的「通过」。
4. 不刷新、不跳转，直接观察侧边栏。

## 预期结果

- 决策前，侧边栏「组织发布管理」行的 `.wk-mcp-sidebar__badge` 文本为 `1`。
- 点击「通过」后，待审核列表显示空态「暂无待审核申请」。
- 同一页面实例内，侧边栏徽标消失（计数归零时整个徽标不渲染）。

## 反例

- 如果徽标只在挂载时拉取一次，点击「通过」后列表会清空而徽标仍停在 `1`，只有整页刷新才纠正——这正是本用例守护的缺陷。
- 如果把失效逻辑挂在调用点而不是接口上，从抽屉里做出的决策、申请人的「取消审核」、发布触发的送审、下架等路径中总会有一条漏掉，徽标只在部分操作后更新。
- 如果改用轮询「修」这个问题，徽标会在一个固定延迟后才追上，而不是立即更新；用一个足够短的超时断言仍会失败。

## 视觉基准

不建 pixel baseline; 用 `getByRole` 定位侧边栏行，再用 `.wk-mcp-sidebar__badge` 类选择器断言计数存在与消失。

## 摸清依据

- `packages/dmworkmcp/src/components/MarketSidebar.tsx:108-121`: 侧边栏 review 行的徽标渲染与计数为 0 时隐藏。
- `packages/dmworkmcp/src/components/MarketSidebar.tsx:155-171`: `<ReviewGateProbe />` 用一个独立的 `useReviewRequests`（`pageSize: 1`）拉徽标计数。
- `packages/dmworkskillmarket/src/components/ReviewQueue.tsx:322-364`: 队列自己的决策处理与 `refreshAllAsync`，只刷新列表。
- `packages/dmworkskillmarket/src/api/reviewSignal.ts`: 审核写操作失效信号，以及为什么它挂在接口而不是调用点上。
- `packages/dmworkskillmarket/src/api/skillApi.ts`: 被 `withReviewInvalidation` 包裹的写接口清单。
- `packages/dmworkskillmarket/src/hooks/useReviewRequests.ts`: 订阅失效信号后重新读取。
