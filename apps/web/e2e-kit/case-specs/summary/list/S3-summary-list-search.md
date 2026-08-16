# S3 Summary List Search

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S3 @p1 @summary @list @summary-list @summary-search`

## 目标

验证 Summary 列表搜索框能按关键词刷新列表，只展示命中的总结卡片。这条 case 守护列表搜索 debounce 后的 UI 结果，不检查请求参数本身。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- Per-case MSW handler: `s3-summary-list-search.ts`
  - `GET */summary/api/v1/summaries` — 根据 query `keyword` 返回列表：无关键词返回两条，关键词包含「客户」时只返回「S3 客户反馈总结」。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 观察初始列表包含「S3 周报总结」和「S3 客户反馈总结」。
3. 在搜索框「搜索总结...」输入「客户」。
4. 等待列表刷新。

## 预期结果

- 初始列表显示两条总结：「S3 周报总结」和「S3 客户反馈总结」。
- 搜索「客户」后，列表显示「S3 客户反馈总结」。
- 搜索「客户」后，列表不再显示「S3 周报总结」。
- 搜索后不显示空态「暂无总结记录」。

## 反例

- 搜索命中后，不应仍显示未命中的「S3 周报总结」。
- 搜索命中后，不应显示空态「暂无总结记录」。

## 视觉基准

不建 pixel baseline；用搜索框 placeholder 和列表文案断言。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryListPage.tsx:155`: 列表页从 `api.listSummaries` 读取数据。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:301`: 搜索框变更后 debounce 触发 `loadData()`。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:172`: `loadData()` 把 `keyword` 放进 `ListSummariesParams`。
- `packages/dmworksummary/src/api/summaryApi.ts:526`: `listSummaries()` 请求 `/summary/api/v1/summaries`。
- `packages/dmworksummary/src/types/summary.ts:173`: `SummaryListItem` 列表项字段 shape。
- `packages/dmworksummary/src/i18n/zh-CN.json:157`: 搜索框实际文案「搜索总结...」。
