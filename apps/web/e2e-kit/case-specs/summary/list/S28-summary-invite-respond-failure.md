# S28 Summary Invite Respond Failure

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S28 @p1 @summary @list @summary-list @summary-invite @error-state`

## 目标

验证 Summary 协作邀请响应失败时，页面展示操作失败提示并保留待确认卡片与操作入口，用户不会误以为邀请已经处理成功。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s28-summary-invite-respond-failure.ts`
  - Summary 列表返回一条当前用户待确认邀请。
  - 响应邀请接口返回 HTTP 500，模拟服务端操作失败。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表中找到复用的 `S25 同意邀请总结`待确认卡片。
3. 点击「同意」。
4. 观察失败提示和卡片状态。

## 预期结果

- 点击「同意」后显示「操作失败」。
- `S25 同意邀请总结` 卡片仍显示「同意」和「拒绝」操作入口。
- 卡片未被刷新为已同意或生成中状态。

## 反例

- 业务失败被当作成功时，卡片会错误地移除操作入口，case 应失败。
- 失败后列表被清空或进入加载失败态，用户无法继续处理邀请，case 应失败。

## 视觉基准

不建 pixel baseline；用卡片、toast 和操作按钮断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryListPage.tsx:513-520`: 邀请响应失败显示 operationFailed toast，不更新本地列表。
- `packages/dmworksummary/src/components/SummaryCard.tsx:71-76,249-260`: pending participant 渲染同意/拒绝按钮。
- `packages/dmworksummary/src/api/summaryApi.ts:891-893`: `respondToTask()` 调用响应接口。
- `packages/dmworksummary/src/i18n/zh-CN.json:14`: 操作失败文案。
