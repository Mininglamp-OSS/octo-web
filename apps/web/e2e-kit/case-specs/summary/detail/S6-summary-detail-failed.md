# S6 Summary Detail Failed

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S6 @p1 @summary @detail @summary-detail`

## 目标

验证用户从 Summary 列表打开一条失败总结时，详情页展示失败态和后端错误原因，不展示已完成总结正文。这条 case 守护失败结果的可见反馈分支。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- Per-case MSW handler: `s6-summary-detail-failed.ts`
  - `GET */summary/api/v1/summaries` — 返回一条状态为 `FAILED(4)` 的总结 `S6 失败总结`。
  - `GET */summary/api/v1/summaries/9601` — 返回 `{code,message,data: SummaryDetail}`，其中 `status=4` 且 `error_message` 为 `S6 模拟生成失败：模型服务暂不可用`。
  - `GET */summary/api/v1/summary-templates` — 创建页预加载模板兜底，避免漏 mock。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击「S6 失败总结」。
3. 在详情页查看失败态。

## 预期结果

- 列表页显示「S6 失败总结」，并显示状态「失败」。
- 点击卡片后，详情页显示标题「S6 失败总结」。
- 详情页显示「总结生成失败」。
- 详情页显示错误原因「S6 模拟生成失败：模型服务暂不可用」。

## 反例

- 失败详情页不应显示已完成总结正文标题「📝 总结内容」。
- 失败详情页不应显示「AI 摘要」或任何 mock 的完成内容。

## 视觉基准

不建 pixel baseline；用实际文案断言失败态结构。

## 摸清依据

- `packages/dmworksummary/src/types/summary.ts:8`: `TaskStatus.FAILED` 为 `4`。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:346`: 点击列表卡片进入 `SummaryDetailPage`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:607`: 详情页调用 `getSummaryDetail()`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2423`: `renderFailed()` 渲染失败态。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2452`: 失败态标题来自 `summary.detail.failedTitle`。
- `packages/dmworksummary/src/i18n/zh-CN.json`: `summary.detail.failedTitle` 实际文案为「总结生成失败」。
- `packages/dmworksummary/src/api/summaryApi.ts:526`: 列表接口 `listSummaries()` 请求 `/summaries`。
- `packages/dmworksummary/src/api/summaryApi.ts:533`: 详情接口 `getSummaryDetail()` 请求 `/summaries/:taskId`。
