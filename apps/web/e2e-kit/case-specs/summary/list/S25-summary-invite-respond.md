# S25 Summary Invite Respond

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P2
- Tags: `@S25 @p2 @summary @list @summary-list @summary-invite`

## 目标

验证 Summary 列表中待当前用户确认的多人协作邀请，可以在卡片上点击「同意」或「拒绝」，操作成功后显示对应 toast，并刷新列表状态。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s25-summary-invite-respond.ts`
  - `GET */summary/api/v1/summaries` — 返回两条待确认邀请：`S25 同意邀请总结` 和 `S25 拒绝邀请总结`。
  - `POST */summary/api/v1/summaries/:taskId/respond` — 根据 taskId/action 标记同意或拒绝。
  - 再次 `GET */summary/api/v1/summaries` — 同意项刷新为生成中，拒绝项刷新为已取消，且对应卡片不再显示同意/拒绝按钮。
  - `POST */summary/api/v1/summaries/batch-status` — 兜底返回当前状态，避免列表轮询漏 mock。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页找到 `S25 同意邀请总结`，点击卡片内「同意」。
3. 等待 toast「已同意」和列表刷新。
4. 在列表页找到 `S25 拒绝邀请总结`，点击卡片内「拒绝」。
5. 等待 toast「已拒绝」和列表刷新。

## 预期结果

- 初始列表显示 `S25 同意邀请总结` 和 `S25 拒绝邀请总结`。
- 两张待确认卡片都显示「同意」和「拒绝」按钮。
- 点击同意后出现 toast「已同意」，`S25 同意邀请总结` 卡片不再显示同意/拒绝按钮。
- 点击拒绝后出现 toast「已拒绝」，`S25 拒绝邀请总结` 卡片不再显示同意/拒绝按钮。
- 全程不显示「加载失败」。

## 反例

- 如果 respond 接口漏 mock，点击同意/拒绝后应出现 401 或 sanityCheck 报漏 mock。
- 如果成功后没有刷新列表，卡片仍显示同意/拒绝按钮，case 应失败。
- 如果参与者状态 shape 不匹配，卡片不会识别为待确认邀请，case 应因找不到按钮失败。

## 视觉基准

不建 pixel baseline；用卡片标题、同意/拒绝按钮和成功 toast 断言结构。

## 摸清依据

- `packages/dmworksummary/src/components/SummaryCard.tsx:71`: 卡片根据当前登录用户在 participants 中的状态识别 pending invite。
- `packages/dmworksummary/src/components/SummaryCard.tsx:249`: 待确认邀请渲染「同意」「拒绝」按钮。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:367`: `handleRespond()` 调用 `respondToTask()` 并刷新列表。
- `packages/dmworksummary/src/api/summaryApi.ts:826`: `respondToTask()` 请求 `/summaries/:id/respond`。
- `packages/dmworksummary/src/i18n/zh-CN.json:55-59`: 同意/拒绝按钮和成功 toast 文案。
