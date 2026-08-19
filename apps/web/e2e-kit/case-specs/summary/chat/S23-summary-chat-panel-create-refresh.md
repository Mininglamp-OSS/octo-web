# S23 Summary Chat Panel Create Refresh

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture, mock IM runtime
- 优先级: P2
- Tags: `@S23 @p2 @summary @chat @summary-panel @summary-create`

## 目标

验证聊天内 Summary Panel 在当前聊天没有历史总结时会进入新建视图，用户填写主题并创建成功后，panel 回到历史列表并展示新总结。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- mock-im-runtime seed:
  - group: `s23-project-group` / `S23 项目群`
  - conversation: `s23-project-group` group conversation，作为聊天页当前会话。
- Per-case MSW handler: `e2e-kit/msw-handlers/s23-summary-chat-panel-create-refresh.ts`
  - `GET */summary/api/v1/summaries?origin_channel_id=s23-project-group` — 创建前返回空，创建后返回 `S23 聊天内新建总结`。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表。
  - `POST */summary/api/v1/summaries` — 标记创建成功并返回 `{task_id:23023}`。

## 用户操作步骤

1. 从默认 app shell 点击主导航「会话」。
2. 在最近会话中点击 `S23 项目群`。
3. 点击聊天 header 右侧「智能总结」星标入口。
4. 在右侧 panel 的新建视图输入 `S23 聊天内新建总结`。
5. 点击「快速总结」。
6. 等待 panel 回到历史列表。

## 预期结果

- 当前聊天打开后，header 显示 `S23 项目群`。
- 点击「智能总结」后，panel 显示创建页标题「邀请同事一起总结信息」。
- 创建成功后出现 toast「总结任务已创建」。
- panel 回到历史列表，显示标题「聊天内的智能总结」。
- 历史列表显示 `S23 聊天内新建总结`。

## 反例

- 如果 star button 没有识别当前聊天无历史总结，panel 不会进入新建视图，case 应失败。
- 如果创建成功后没有触发 `summary-list-refresh-requested`，panel 历史列表不会出现新总结，case 应失败。
- 如果创建接口漏 mock，sanityCheck 应报 401。

## 视觉基准

不建 pixel baseline；用聊天名、panel 创建页、toast 和刷新后的历史卡片断言结构。

## 摸清依据

- `packages/dmworksummary/src/components/ChatSummaryStarButton.tsx:74`: star button 通过 `listSummaries({ origin_channel_id })` 判断是否有历史总结。
- `packages/dmworksummary/src/components/ChatSummaryStarButton.tsx:116`: 无历史时 emit `summaryPanelView='new'`。
- `packages/dmworksummary/src/components/ChatSummaryPanel.tsx:182`: create view 内嵌 `SummaryCreatePage`。
- `packages/dmworksummary/src/components/ChatSummaryPanel.tsx:140`: 创建成功后切回 list，并延迟 emit `summary-list-refresh-requested`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:640`: 创建成功 toast 使用 `summary.create.success`。
