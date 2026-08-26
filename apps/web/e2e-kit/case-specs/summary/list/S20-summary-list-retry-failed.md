# S20 Summary List Retry Failed

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S20 @p1 @summary @list @summary-list @summary-retry`

## 目标

验证 Summary 列表中的失败任务可以从卡片菜单点击「重试」，重试成功后显示 toast「已重新提交总结任务」，列表刷新并进入生成中状态。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s20-summary-list-retry-failed.ts`
  - `GET */summary/api/v1/summaries` — 重试前返回 `FAILED(4)` 的 `S20 失败可重试总结`，重试后返回 `PROCESSING(2)`。
  - `POST */summary/api/v1/summaries/20020/regenerate` — 标记重试成功。
  - `POST */summary/api/v1/summaries/batch-status` — 兜底返回当前状态，避免列表轮询漏 mock。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页查看失败卡片 `S20 失败可重试总结`。
3. 打开卡片右下角更多菜单。
4. 点击「重试」。
5. 等待列表刷新。

## 预期结果

- 初始卡片显示 `S20 失败可重试总结` 和状态「失败」。
- 更多菜单中显示「重试」。
- 点击后出现 toast「已重新提交总结任务」。
- 刷新后卡片显示生成中文案「AI正在分析聊天记录...」。
- 刷新后不再显示状态「失败」。

## 反例

- 如果 regenerate 接口漏 mock，点击后应出现 401 或 sanityCheck 报漏 mock。
- 如果重试成功后没有刷新列表，卡片会继续显示「失败」，case 应失败。
- 如果重试后状态没有进入 processing/pending，生成中文案不会出现，case 应失败。

## 视觉基准

不建 pixel baseline；用卡片菜单、toast 和状态文案断言结构。

## 摸清依据

- `packages/dmworksummary/src/components/SummaryCard.tsx:196`: failed 状态卡片菜单渲染「重试」。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:377`: `handleRetry()` 调用 `api.regenerateSummary()` 并重新加载列表。
- `packages/dmworksummary/src/api/summaryApi.ts:567`: `regenerateSummary()` 请求 `/summaries/:id/regenerate`。
- `packages/dmworksummary/src/i18n/zh-CN.json:161`: 重试成功 toast「已重新提交总结任务」。
- `packages/dmworksummary/src/i18n/zh-CN.json:66`: 失败状态文案。
