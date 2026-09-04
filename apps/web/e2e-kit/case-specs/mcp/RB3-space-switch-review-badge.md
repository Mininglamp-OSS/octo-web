# RB3 切换组织后组织发布管理徽标读取新组织的待审数

## Metadata

- Case 类型: 回归守护
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@RB3 @p1 @mcp @market @review`

## 目标

验证切换 Space 之后，侧边栏「组织发布管理」的待审计数徽标读取的是**新 Space** 的数字，
而不是把上一个 Space 的计数留在屏幕上。

## 为什么会错

审核计数是 Space 维度的（每次读取都带 `X-Space-Id` 请求头，见
`packages/dmworkskillmarket/src/api/skillApiReal.ts` 的 `getAuthHeaders`），但：

- `useReviewRequests` 的 fetch 只以 `[enabled, mode, status, pageSize]` 为 key，
  切 Space 一个都不动；
- `enabled` 就是 `isReviewer`，owner 切到另一个自己也是 owner 的 Space 时它仍是 `true`，
  reviewer 门禁救不了这个 case；
- 右侧市场页会被 `MarketSidebar.handleSpaceChanged` 整个替换重挂，所以它们各自的
  `space-changed` handler 里那句显式刷新看起来「多余」；而**侧边栏自己从不重挂**，
  所以它是唯一一个没人替它重读的读取点。

## 前置条件

- fixture: `fixtures-authed`。
- Per-case MSW handler: `e2e-kit/msw-handlers/rb3-space-switch-review-badge.ts`
  - `GET /space/my` — 返回两个 Space：甲组织 `e2e-space-001`、乙组织 `e2e-space-002`，
    用户在两边都是 `role: 1`（owner）。
  - `GET /market/api/v1/plugins/review_requests` — **按请求头 `X-Space-Id` 分流**：
    甲组织 1 条 pending，乙组织 3 条。
  - 两边都是**非零**且**不相等**，这是本 case 的关键：`1 → 0` 是有歧义的，因为探针被
    禁用或状态被清空时徽标同样会消失，"徽标不见了" 只有在你另外知道没有东西清空它时
    才算重读的证据；`1 → 3` 只可能由一件事产生 —— 一次带着新 Space 请求头的新读取。

## 用户操作步骤

1. 打开 `/mcp-market/skills`（技能市场）。**站在技能页而不是审核页**：徽标必须在
   `ReviewQueue` 未挂载时也正确，这正是它是一个独立读取的原因。
2. 确认侧边栏「组织发布管理」徽标为 `1`。
3. 点击 NavRail 底部的「切换组织」，选择「乙组织」。
4. 不刷新、不跳转，直接观察侧边栏。

## 预期结果

- 切换前徽标为 `1`（甲组织）。
- 切换后徽标为 `3`（乙组织）。

## 反例

- 修复前实测：切换后 `window.fetch` 上**没有任何** `review_requests` 请求发出，徽标
  十秒不动地停在 `1`。连跑三次结果一致。
- 如果改用 `notifyReviewsChanged()` 来实现：那是在宣称「审核队列发生了写操作」，
  而切 Space 并不是审核类写操作。这个说法对其余订阅者是错的，而且它们各自已经处理了
  切 Space。所以这里用的是 `refresh()`，和三个市场页 `space-changed` handler 的做法一致。
- 如果把重读放进 `useReviewRequests` 内部：能修，但那会把三个市场页现有的显式刷新变成
  隐式行为，属于对一个四处共用的 hook 的更大改动；本 case 只钉住可观察行为，不钉住这个选择。

## 视觉基准

不建 pixel baseline；用 `getByRole` 定位侧边栏行和「切换组织」按钮，再用
`.wk-mcp-sidebar__badge` 类选择器断言计数文本。

## 摸清依据

- `packages/dmworkmcp/src/components/MarketSidebar.tsx`: `<ReviewGateProbe />` 的
  `space-changed` 重读。
- `packages/dmworkskillmarket/src/hooks/useReviewRequests.ts`: fetch 的 key 集合。
- `packages/dmworkskillmarket/src/hooks/useSpaceRole.ts`: 切 Space 时 role 的更新路径。
- `apps/web/src/Pages/Main/index.tsx`: `applySpaceSelection` 先写
  `WKApp.shared.currentSpaceId` 再 emit `space-changed`，所以重读带的是新 Space 的头。
- `apps/web/src/Pages/Main/index.tsx` `MainContentLeft`: 已访问路由靠 `display` 切换常驻
  DOM，侧边栏因此不会随切 Space 重挂。
- `packages/dmworkmcp/src/components/__tests__/MarketSidebar.test.tsx`: 同一行为的单测。
