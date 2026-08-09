# S17 Summary Detail Delete

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S17 @p1 @summary @detail @summary-detail @summary-delete`

## 目标

验证 creator 在已完成总结详情页点击删除按钮后，确认弹窗出现；确认删除成功后，页面回到列表，目标卡片消失并显示空态。这条 case 守护详情页破坏性操作在 mock 隔离下的用户可观察结果。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s17-summary-detail-delete.ts`
  - `GET */summary/api/v1/summaries` — 删除前返回一条已完成总结 `S17 待删除总结`，删除后返回空列表。
  - `GET */summary/api/v1/summaries/17017` — 返回对应详情。
  - `DELETE */summary/api/v1/summaries/17017` — 标记删除成功。
  - `POST */summary/api/v1/summaries/17017/read`、`GET */summary/api/v1/summaries/17017/versions` — 详情页后续请求兜底。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击 `S17 待删除总结` 打开详情。
3. 点击详情页头部删除图标按钮。
4. 在确认弹窗中点击「确定」。
5. 查看列表刷新后的状态。

## 预期结果

- 删除前列表和详情页都显示 `S17 待删除总结`。
- 点击删除后显示确认弹窗「确认删除」。
- 确认后出现 toast「删除成功」。
- 页面回到列表，`S17 待删除总结` 不再出现。
- 列表显示空态「暂无总结记录」。

## 反例

- 如果 `DELETE /summaries/:id` 漏 mock，确认后应出现 401 或 sanityCheck 报漏 mock。
- 如果删除成功后没有触发列表刷新，目标卡片仍会留在列表，case 应失败。
- 如果误删后仍停留详情页，详情标题 `S17 待删除总结` 会仍可见，case 应失败。

## 视觉基准

不建 pixel baseline；用删除确认弹窗、toast、列表卡片消失和空态断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:940`: `handleDeleteTask()` 调用 `api.deleteSummary()` 并 popToRoot。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3999`: creator 详情页头部渲染删除按钮并打开 `Modal.confirm`。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:82`: 列表监听 `summary-list-refresh-requested` 后重新加载。
- `packages/dmworksummary/src/api/summaryApi.ts:563`: `deleteSummary()` 请求 `DELETE /summaries/:id`。
- `packages/dmworksummary/src/i18n/zh-CN.json:158`: 删除成功 toast「删除成功」。
- `packages/dmworksummary/src/i18n/zh-CN.json:542-543`: 删除确认弹窗文案。
