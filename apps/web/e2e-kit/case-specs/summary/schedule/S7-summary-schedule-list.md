# S7 Summary Detail Schedule Summary

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S7 @p1 @summary @schedule @summary-detail @summary-schedule`

## 目标

验证用户从 Summary 列表打开一条带定时配置的已完成总结时，详情页标题下方能展示当前定时更新信息。这条 case 守护详情页 schedule_id → getSchedule → renderScheduleSummary 的真实链路。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- Per-case MSW handler: `s7-summary-schedule-list.ts`
  - `GET */summary/api/v1/summaries` — 返回一条已完成总结 `S7 定时项目总结`，带 `schedule_id=9701`。
  - `GET */summary/api/v1/summaries/9701` — 返回对应详情，`permissions.can_view_schedule=true`。
  - `GET */summary/api/v1/summary-schedules/9701` — 返回每周一 09:30 执行的 active 定时配置。
  - `POST */summary/api/v1/summaries/9701/read` 与 `GET */summary/api/v1/summaries/9701/versions` — 详情页后续请求兜底。
  - `GET */summary/api/v1/summary-templates` — 创建页预加载模板兜底。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击「S7 定时项目总结」。
3. 在详情页查看标题下方的定时说明。

## 预期结果

- 列表页显示「S7 定时项目总结」。
- 详情页显示标题「S7 定时项目总结」。
- 标题下方显示「定时：」。
- 定时说明包含「每周」、「周一」和「09:30」。
- 定时说明包含「下次」。

## 反例

- 详情页不应显示「定时已关闭」。
- 详情页不应显示「加载失败」或「网络连接异常，请检查网络后重试」。

## 视觉基准

不建 pixel baseline；用实际文案断言定时信息展示。

## 摸清依据

- `packages/dmworksummary/src/module.tsx:149`: `/summary/schedules` 路由存在，但本 case 使用真实列表 → 详情入口。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:607`: 详情页调用 `getSummaryDetail()`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:640`: 详情带 `schedule_id` 时调用 `loadSchedule()`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:693`: `loadSchedule()` 调用 `api.getSchedule()`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3830`: `renderScheduleSummary()` 渲染详情页定时说明。
- `packages/dmworksummary/src/utils/summaryHelpers.ts:561`: `formatScheduleSummary()` 组装「定时：」说明。
- `packages/dmworksummary/src/api/summaryApi.ts:922`: `getSchedule()` 请求 `/summary-schedules/:id`。
- `packages/dmworksummary/src/i18n/zh-CN.json`: `summary.detail.schedulePrefix` 实际文案「定时：」。
