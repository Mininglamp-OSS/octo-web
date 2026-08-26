# S18 Summary List Poll Completed

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S18 @p1 @summary @list @summary-list @summary-poll`

## 目标

验证 Summary 列表中的生成中任务会通过 batch-status 轮询刷新为已完成，用户随后能点击该卡片进入详情查看正文。这条 case 守护列表动态状态刷新链路：生成中卡片、`batchStatus()`、状态变更、详情加载。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s18-summary-list-poll-completed.ts`
  - `GET */summary/api/v1/summaries` — 返回一条初始 `PROCESSING(2)` 的总结 `S18 轮询总结`。
  - `POST */summary/api/v1/summaries/batch-status` — 第一次轮询返回 `COMPLETED(3)`。
  - `GET */summary/api/v1/summaries/18018` — 返回已完成详情，包含正文 `S18 轮询后已完成`。
  - `POST */summary/api/v1/summaries/18018/read`、`GET */summary/api/v1/summaries/18018/versions` — 详情页后续请求兜底。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页查看生成中卡片 `S18 轮询总结`。
3. 等待列表轮询刷新状态。
4. 点击已完成的 `S18 轮询总结` 卡片进入详情。

## 预期结果

- 初始列表显示 `S18 轮询总结` 和生成中文案「AI正在分析聊天记录...」。
- 轮询后卡片显示状态「已完成」。
- 点击卡片后详情页显示标题 `S18 轮询总结`。
- 详情页显示「AI 摘要」和正文 `S18 轮询后已完成`。
- 全程不显示「加载失败」。

## 反例

- 如果列表没有启动 batch poll，卡片会一直停留在「AI正在分析聊天记录...」，case 应 timeout。
- 如果 batch-status 返回后没有更新本地状态，列表不会出现「已完成」，case 应失败。
- 如果详情接口漏 mock，点击卡片后会显示「加载失败」或 sanityCheck 报 401。

## 视觉基准

不建 pixel baseline；用生成中文案、状态文案和详情正文断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryListPage.tsx:227`: `maybeStartBatchPoll()` 对 pending/waiting/processing 任务启动轮询。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:258`: `doBatchPoll()` 调用 `api.batchStatus()` 并更新列表状态。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:346`: 点击卡片进入 `SummaryDetailPage`。
- `packages/dmworksummary/src/components/SummaryCard.tsx:90`: processing/pending 卡片显示生成中文案。
- `packages/dmworksummary/src/api/summaryApi.ts:798`: `batchStatus()` 请求 `/summaries/batch-status`。
- `packages/dmworksummary/src/i18n/zh-CN.json:64-65`: 「生成中」「已完成」状态文案。
- `packages/dmworksummary/src/i18n/zh-CN.json:552`: 生成中文案「AI正在分析聊天记录...」。
