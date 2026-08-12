# S13 Summary Agent New Session

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S13 @p1 @summary @agent @summary-agent @summary-reference`

## 目标

验证 Agent 总结工作台在已有引用和对话消息后，点击「新会话」会清空当前消息、session 和引用状态，回到可重新选择引用的空白 Agent 工作台。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s13-summary-agent-new-session.ts`
  - `GET */summary/api/v1/summaries` — 普通列表入口返回空；引用选择器（page_size=50）返回 `S13 可引用总结`。
  - `GET */summary/api/v1/summaries/13013` — 返回引用 side panel 详情兜底。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表。
  - `GET */summary/api/v1/agent/chat/history` — 返回空历史。
  - `POST */summary/api/v1/agent/chat/stream` — 返回 done 事件，reply 为 `S13 Agent 已生成第一轮回复`。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在空态点击「创建第一份总结」进入创建页。
3. 切换到「Agent 总结」。
4. 点击「引用总结」，选择 `S13 可引用总结`。
5. 发送 `S13 第一轮问题` 并等待 Agent 回复。
6. 点击「新会话」。

## 预期结果

- 选择引用后顶部显示「已引用」和 `S13 可引用总结`。
- 发送后用户气泡 `S13 第一轮问题` 和 assistant 气泡 `S13 Agent 已生成第一轮回复` 可见。
- 点击「新会话」后，「已引用」卡片消失，重新显示「引用总结」入口。
- 点击「新会话」后，`S13 第一轮问题` 和 `S13 Agent 已生成第一轮回复` 都不再显示。
- 欢迎语「你好，我是总结助手，想总结什么尽管告诉我。」仍可见。

## 反例

- 如果新会话只清消息但没有清引用，后续发送会误带旧 `referenced_task_ids`，case 应因「已引用」仍可见而失败。
- 如果新会话只清引用但没有清消息，旧用户/assistant 气泡仍留在工作台，case 应失败。
- 如果旧 session history 在新会话后被异步回灌，旧消息会重新出现，case 应失败。

## 视觉基准

不建 pixel baseline；用引用卡片、消息气泡和欢迎语断言工作台状态。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:822`: `handleNewSession()` 清 localStorage session、引用、messages 和 referencedTask。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:845`: `renderReferenceHeader()` 渲染「引用总结」入口和引用卡片。
- `packages/dmworksummary/src/components/AgentChatPanel.tsx:363`: Agent panel header 渲染「新会话」按钮。
- `packages/dmworksummary/src/components/AgentChatPanel.tsx:381`: Agent panel 按 messages 渲染 user/assistant 气泡。
- `packages/dmworksummary/src/i18n/zh-CN.json:188-190`: Agent 欢迎语、新会话和发送按钮文案。
