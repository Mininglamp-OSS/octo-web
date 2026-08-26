# S15 Summary Detail Edit Save

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S15 @p1 @summary @detail @summary-detail @summary-edit`

## 目标

验证 creator 在已完成的传统总结详情页可以进入正文编辑，取消后原文保持不变；再次编辑并保存后出现「保存成功」toast，详情页重新加载并显示更新后的正文。这条 case 守护详情页编辑态、底部保存栏和 `PUT /summaries/:id/edit` 链路。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s15-summary-detail-edit-save.ts`
  - `GET */summary/api/v1/summaries` — 返回一条已完成总结 `S15 可编辑总结`。
  - `GET */summary/api/v1/summaries/15015` — 首次返回正文 `S15 原始正文内容`，保存后返回 `S15 已保存正文内容`。
  - `PUT */summary/api/v1/summaries/15015/edit` — 标记保存成功并返回 `edited_at`。
  - `POST */summary/api/v1/summaries/15015/read`、`GET */summary/api/v1/summaries/15015/versions` — 详情页后续请求兜底。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击 `S15 可编辑总结` 打开详情。
3. 点击正文标题行的「编辑」。
4. 在编辑器中输入 `S15 草稿取消内容`，点击底部「取消」。
5. 再次点击「编辑」。
6. 在编辑器中输入 `S15 已保存正文内容`，点击底部「保存」。

## 预期结果

- 详情页初始显示 `S15 原始正文内容`。
- 进入编辑态后显示 placeholder 为「编辑总结内容...」的 textarea。
- 点击「取消」后退出编辑态，仍显示 `S15 原始正文内容`，不显示 `S15 草稿取消内容`。
- 保存后出现 toast「保存成功」。
- 详情页刷新后显示 `S15 已保存正文内容`。
- 全程不显示「加载失败」。

## 反例

- 如果取消编辑仍写入了草稿内容，页面会显示 `S15 草稿取消内容`，case 应失败。
- 如果保存按钮使用了陈旧 editorSaveFn 或错误 baseResultId，保存后不会刷新到 `S15 已保存正文内容`，case 应失败。
- 如果 edit 接口漏 mock，sanityCheck 应报 401 或页面显示保存失败。

## 视觉基准

不建 pixel baseline；用编辑按钮、textarea、底部保存栏、toast 和正文内容断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2740`: `renderCompleted()` 渲染传统总结正文。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2826`: `renderTeamSummaryHeader()` 在可编辑时渲染「编辑」按钮。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3515`: `handleStartEdit()` 进入编辑态并清理版本面板状态。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3551`: `handleEditSave()` 退出编辑态并重新加载详情。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3556`: `handleEditCancel()` 只退出编辑态，不保存。
- `packages/dmworksummary/src/components/SummaryEditor.tsx:76`: `SummaryEditor.handleSave()` 调用 `editSummary()`。
- `packages/dmworksummary/src/api/summaryApi.ts:714`: `editSummary()` 请求 `PUT /summaries/:id/edit`。
- `packages/dmworksummary/src/i18n/zh-CN.json:567-572`: 编辑器保存成功和 placeholder 文案。
