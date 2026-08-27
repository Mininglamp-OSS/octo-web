# S27 Summary List Load Failure Retry

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S27 @p1 @summary @list @summary-list @summary-retry`

## 目标

验证用户进入 Summary 后触发列表刷新失败时，页面向用户展示可操作的网络错误提示，点击重试后能够恢复列表内容。这条 case 守护异步列表失败后的用户恢复路径。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s27-summary-list-load-failure-retry.ts`
  - 初始 `GET */summary/api/v1/summaries` 返回 HTTP 503。
  - 点击重试后的请求恢复并返回一条可见的 Summary 列表项。
  - `GET */summary/api/v1/summary-templates` 返回空模板列表，作为页面预加载兜底。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 观察列表刷新失败提示。
3. 点击「重试」。
4. 等待列表重新加载。

## 预期结果

- 列表刷新失败时显示「网络连接异常，请检查网络后重试」和「重试」按钮。
- 点击「重试」后，列表显示「S27 重试后恢复总结」。
- 恢复成功后不再显示网络错误提示。

## 反例

- 如果失败后没有展示重试入口，用户无法恢复列表，case 应失败。
- 如果重试后仍停留在错误态或空态，恢复后的 Summary 标题不会出现，case 应失败。

## 视觉基准

不建 pixel baseline；用 `getByRole` + `getByText` 断言错误提示、操作入口和恢复后的列表结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryListPage.tsx:689-691`: 列表加载错误时渲染网络错误文案和「重试」按钮。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:246-262`: 用户触发的列表请求失败后保存错误态，重试重新调用 `loadData()`。
- `packages/dmworksummary/src/api/summaryApi.ts:582-586`: `listSummaries()` 请求 Summary 列表接口。
- `packages/dmworksummary/src/i18n/zh-CN.json:159`: 网络错误提示实际文案。
