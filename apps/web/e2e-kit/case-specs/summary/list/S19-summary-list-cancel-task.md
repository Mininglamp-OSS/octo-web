# S19 Summary List Cancel Task

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S19 @p1 @summary @list @summary-list @summary-cancel`

## 目标

验证 Summary 列表中生成中的任务可以从卡片菜单点击「取消任务」，取消成功后显示 toast「已取消总结任务」，列表刷新并显示已取消状态。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s19-summary-list-cancel-task.ts`
  - `GET */summary/api/v1/summaries` — 取消前返回 `PROCESSING(2)` 的 `S19 可取消总结`，取消后返回 `CANCELLED(5)`。
  - `POST */summary/api/v1/summaries/19019/cancel` — 标记取消成功。
  - `POST */summary/api/v1/summaries/batch-status` — 兜底返回当前状态，避免列表轮询漏 mock。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页查看生成中卡片 `S19 可取消总结`。
3. 打开卡片右下角更多菜单。
4. 点击「取消任务」。
5. 等待列表刷新。

## 预期结果

- 初始卡片显示 `S19 可取消总结` 和「AI正在分析聊天记录...」。
- 更多菜单中显示「取消任务」。
- 点击后出现 toast「已取消总结任务」。
- 刷新后卡片仍显示 `S19 可取消总结`，状态显示「已取消」。
- 取消后不再显示「AI正在分析聊天记录...」。

## 反例

- 如果 cancel 接口漏 mock，点击后应出现 401 或 sanityCheck 报漏 mock。
- 如果取消成功后没有刷新列表，卡片会继续显示「AI正在分析聊天记录...」，case 应失败。
- 如果 batch-status 轮询覆盖了取消状态，卡片不会稳定显示「已取消」，case 应失败。

## 视觉基准

不建 pixel baseline；用卡片菜单、toast 和状态文案断言结构。

## 摸清依据

- `packages/dmworksummary/src/components/SummaryCard.tsx:185`: generating 状态卡片菜单渲染「取消任务」。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:388`: `handleCancel()` 调用 `api.cancelSummary()` 并重新加载列表。
- `packages/dmworksummary/src/api/summaryApi.ts:805`: `cancelSummary()` 请求 `/summaries/:id/cancel`。
- `packages/dmworksummary/src/i18n/zh-CN.json:162`: 取消成功 toast「已取消总结任务」。
- `packages/dmworksummary/src/i18n/zh-CN.json:67`: 已取消状态文案。
