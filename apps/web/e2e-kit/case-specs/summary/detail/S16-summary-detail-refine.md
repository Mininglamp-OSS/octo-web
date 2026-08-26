# S16 Summary Detail Refine

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P2
- Tags: `@S16 @p2 @summary @detail @summary-detail @summary-refine`

## 目标

验证用户在已完成的传统总结详情页点击「重新生成」后，可以选择默认的「按意见调整」，输入修改意见并提交；流式 refine 成功后正文更新，且显示成功 toast。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s16-summary-detail-refine.ts`
  - `GET */summary/api/v1/summaries` — 返回一条已完成传统总结 `S16 可调整总结`。
  - `GET */summary/api/v1/summaries/16016` — 返回详情，包含当前正文 `S16 原始正文内容`。
  - `POST */summary/api/v1/summaries/16016/refine/stream` — 返回 SSE done 事件，包含 `version=2` 和正文 `S16 已按意见调整正文`。
  - `POST */summary/api/v1/summaries/16016/read`、`GET */summary/api/v1/summaries/16016/versions` — 详情页后续请求兜底。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击 `S16 可调整总结` 打开详情。
3. 点击详情页头部「重新生成」。
4. 在弹窗默认「按意见调整」模式下输入 `S16 请补充风险说明`。
5. 点击「按意见调整」。

## 预期结果

- 详情页初始显示 `S16 原始正文内容`。
- 点击后弹窗显示「修改提示词并重新生成」和「按意见调整当前结果」。
- 提交后出现 toast「修改成功，已更新到版本 2」。
- 正文更新为 `S16 已按意见调整正文`。
- 全程不显示「加载失败」。

## 反例

- 如果 refine stream 接口漏 mock，提交后应出现 401 或 sanityCheck 报漏 mock。
- 如果 stream 没有 done payload，页面不会显示成功 toast，case 应失败。
- 如果 refine 后没有更新本地 detail.result，正文仍为 `S16 原始正文内容`，case 应失败。

## 视觉基准

不建 pixel baseline；用弹窗文案、toast 和正文内容断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:1295`: `handleRegenerate()` 打开重新生成/调整弹窗。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:1366`: `handleRegenerateConfirm()` 处理 refine/full regenerate 提交。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:1475`: 传统总结 refine 调用 `streamRefineSummary()`。
- `packages/dmworksummary/src/api/summaryApi.ts:571`: `streamRefineSummary()` 请求 `/summaries/:id/refine/stream`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:1192`: `isRefineDonePayload()` 判断 done payload。
- `packages/dmworksummary/src/i18n/zh-CN.json:450-461`: 调整弹窗和 refine 输入文案。
