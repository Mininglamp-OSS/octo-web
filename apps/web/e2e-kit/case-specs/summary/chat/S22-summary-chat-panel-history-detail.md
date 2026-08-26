# S22 Summary Chat Panel History Detail

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture, mock IM runtime
- 优先级: P1
- Tags: `@S22 @p1 @summary @chat @summary-panel @summary-detail`

## 目标

验证用户在聊天页从频道 header 的「智能总结」入口打开右侧聊天内 Summary Panel，看到当前聊天的总结历史，并点击历史卡片进入内嵌详情。这条 case 守护聊天上下文入口、按当前 channel 过滤的历史列表、panel 内列表/详情切换。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- mock-im-runtime seed:
  - group: `s22-project-group` / `S22 项目群`
  - conversation: `s22-project-group` group conversation，作为聊天页当前会话。
- Per-case MSW handler: `e2e-kit/msw-handlers/s22-summary-chat-panel-history-detail.ts`
  - `GET */summary/api/v1/summaries?origin_channel_id=s22-project-group` — 返回一条已完成总结 `S22 聊天内总结`。
  - `GET */summary/api/v1/summaries/22022` — 返回对应详情，包含摘要和正文 `S22 聊天内详情正文`。
  - `POST */summary/api/v1/summaries/22022/read`、`GET */summary/api/v1/summaries/22022/versions` — 详情页后续请求兜底。

## 用户操作步骤

1. 从默认 app shell 点击主导航「会话」。
2. 在会话列表点击 `S22 项目群`。
3. 点击聊天 header 右侧「智能总结」星标入口。
4. 在右侧 panel 查看「聊天内的智能总结」列表。
5. 点击 `S22 聊天内总结` 卡片进入详情。

## 预期结果

- 聊天页显示当前会话 `S22 项目群`。
- 点击 header「智能总结」后右侧出现 panel 标题「聊天内的智能总结」。
- panel 列表显示 `S22 聊天内总结` 和状态「已完成」。
- 点击历史卡片后 panel 内显示「返回」按钮。
- panel 内详情显示标题 `S22 聊天内总结`。
- panel 内详情显示「AI 摘要」和正文 `S22 聊天内详情正文`。

## 反例

- 如果 star button 的 summary count 请求漏带/漏处理 `origin_channel_id`，panel 会进入新建视图而非历史列表，case 应因找不到「聊天内的智能总结」历史卡片失败。
- 如果 SummaryListPage panel 模式没有按 channelId 过滤，会显示其它聊天总结，case 应因找不到 `S22 聊天内总结` 或详情正文失败。
- 如果内嵌详情漏 mock read/versions 请求，sanityCheck 应报 401。

## 视觉基准

不建 pixel baseline；用聊天名、panel 标题、历史卡片、返回按钮和详情正文断言结构。

## 摸清依据

- `packages/dmworksummary/src/module.tsx:184`: 注册聊天 header 右侧 `ChatSummaryStarButton`。
- `packages/dmworksummary/src/components/ChatSummaryStarButton.tsx:74`: star button 通过 `listSummaries({ origin_channel_id })` 判断是否有历史总结。
- `packages/dmworksummary/src/components/ChatSummaryStarButton.tsx:116`: 有历史时 emit `wk:toggle-summary-panel` 且 `summaryPanelView='history'`。
- `packages/dmworkbase/src/Pages/Chat/index.tsx:1285`: `showSummaryPanel` 时渲染 `.wk-summary-panel`。
- `packages/dmworksummary/src/components/ChatSummaryPanel.tsx:174`: panel list 视图复用 `SummaryListPage` 并传入 `channelId`。
- `packages/dmworksummary/src/components/ChatSummaryPanel.tsx:207`: panel detail 视图复用 `SummaryDetailPage`。
- `packages/dmworksummary/src/i18n/zh-CN.json:207-212`: 聊天内 Summary Panel 标题、返回和入口 tooltip 文案。
