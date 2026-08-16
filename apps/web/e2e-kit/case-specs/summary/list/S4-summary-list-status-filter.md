# S4 Summary List Status Filter

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S4 @p1 @summary @list @summary-list @summary-filter`

## 目标

验证 Summary 列表状态筛选能切换列表结果：默认展示已完成和失败总结，选择「失败」后只展示失败卡片。这条 case 守护状态下拉筛选的 UI 结果。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- Per-case MSW handler: `s4-summary-list-status-filter.ts`
  - `GET */summary/api/v1/summaries` — 根据 query `status` 返回列表：无 status 返回已完成 + 失败两条，`status=4` 返回失败一条。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 观察初始列表包含「S4 已完成总结」和「S4 失败总结」。
3. 打开状态筛选「全部状态」。
4. 点击「失败」。
5. 等待列表刷新。

## 预期结果

- 初始列表显示「S4 已完成总结」和「S4 失败总结」。
- 状态筛选菜单包含「失败」。
- 选择「失败」后，列表显示「S4 失败总结」。
- 选择「失败」后，列表不再显示「S4 已完成总结」。

## 反例

- 选择「失败」后，不应继续显示状态为「已完成」的「S4 已完成总结」。
- 选择「失败」后，不应显示空态「暂无总结记录」。

## 视觉基准

不建 pixel baseline；用筛选文案和列表卡片文案断言。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryListPage.tsx:49`: 状态筛选选项包含全部、等待中、生成中、已完成、失败、已取消。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:296`: `handleStatusChange` 更新 `statusFilter` 并重载列表。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:172`: `loadData()` 把 `statusFilter` 放进 `ListSummariesParams`。
- `packages/dmworksummary/src/api/summaryApi.ts:526`: `listSummaries()` 请求 `/summary/api/v1/summaries`。
- `packages/dmworksummary/src/types/summary.ts:8`: `TaskStatus.FAILED` 为 `4`。
- `packages/dmworksummary/src/i18n/zh-CN.json:61`: 状态实际文案包含「已完成」和「失败」。
