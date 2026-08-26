# S21 Summary List Load More

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P2
- Tags: `@S21 @p2 @summary @list @summary-list @pagination`

## 目标

验证 Summary 列表在第一页未加载完全部数据时，用户滚动到底部会触发加载下一页，并在全部加载完成后显示「没有更多了」。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s21-summary-list-load-more.ts`
  - `GET */summary/api/v1/summaries?page=1&page_size=20` — 返回 20 条 S21 列表项，`total=21`。
  - `GET */summary/api/v1/summaries?page=2&page_size=20` — 返回第 21 条 `S21 第二页总结`，`total=21`。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 等待第一页第一条 `S21 第 01 条总结` 出现。
3. 滚动列表到底部。
4. 等待第二页 `S21 第二页总结` 出现。

## 预期结果

- 初始列表显示 `S21 第 01 条总结`。
- 滚动到底部后显示 `S21 第二页总结`。
- 全部加载后列表底部显示「没有更多了」。
- 全程不显示「暂无总结记录」或「加载失败」。

## 反例

- 如果滚动没有触发 `loadMore()`，`S21 第二页总结` 不会出现，case 应 timeout。
- 如果 handler 忽略 `page` 参数一直返回第一页，第二页唯一标题不会出现，case 应失败。
- 如果 total/hasMore 计算错误，加载完后不会显示「没有更多了」，case 应失败。

## 视觉基准

不建 pixel baseline；用第一页标题、第二页标题和「没有更多了」断言分页结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryListPage.tsx:194`: 列表滚动到底部附近触发 `loadMore()`。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:202`: `loadMore()` 请求下一页并 append 到列表。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:569`: `!hasMore && items.length > pageSize` 时显示「没有更多了」。
- `packages/dmworksummary/src/api/summaryApi.ts:526`: `listSummaries()` 请求 `/summary/api/v1/summaries`。
- `packages/dmworksummary/src/i18n/zh-CN.json:160`: 底部文案「没有更多了」。
