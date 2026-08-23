# S9 Summary Agent Chat Save

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0
- Tags: `@S9 @p0 @summary @agent @summary-agent @summary-create @summary-detail`

## 目标

验证用户能从「智能总结」创建页切换到 P0 主路径「Agent 总结」，发送需求后看到 Agent 流式回复，并把当前对话产出保存为总结，保存成功后进入新总结详情页查看 AI 摘要和正文。这条 case 守护 Agent 总结的最小成功链路：模式切换、SSE 回复、保存弹窗、保存成功 toast、详情加载。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- baseline MSW handler 已覆盖 app shell / chat bootstrap 所需接口。
- Per-case MSW handler: `e2e-kit/msw-handlers/s9-summary-agent-chat-save.ts`
  - `GET */summary/api/v1/summaries` — 初始返回空列表，让用户从空态进入创建页。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表和 `custom_template_limit`，供创建页 mount。
  - `POST */summary/api/v1/agent/chat/stream` — 返回 `text/event-stream`，包含 progress 和 done 事件，done.reply 为 `S9 Agent 已整理项目风险和下周计划`。
  - `POST */summary/api/v1/summaries/agent/finalize` — 返回 `202 + {task_id:9901,status:0}`（PENDING）。
  - `POST */summary/api/v1/summaries/agent` — legacy fallback，返回 `{task_id:9901,task_no,status,created_at}`。
  - `GET */summary/api/v1/summaries/9901` — 返回新保存的 Agent 总结详情 `S9 Agent 风险总结`。
  - `POST */summary/api/v1/summaries/9901/read`、`GET */summary/api/v1/summaries/9901/versions` — 详情页后续请求兜底。
- 不需要 mock-im-runtime seed；本 case 通过 Agent chat 自身 mock 产出，不依赖真实聊天消息。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」，进入总结列表页（空态）。
2. 点击列表页右上角「+」下拉，选择「Agent 总结」直接进入 Agent 创建会话。
3. 在 Agent 输入框「输入你的问题，回车发送（Shift+Enter 换行）」输入 `S9 总结项目风险和下周计划` 并点击「发送」。
4. 等待 Agent 回复出现。
5. 点击「保存为总结」。
6. 在保存弹窗中输入标题 `S9 Agent 风险总结`，点击「确定」。
7. 在新详情页查看保存后的 Agent 总结。

## 预期结果

- 进入 Agent 模式后显示欢迎语「你好，我是总结助手，想总结什么尽管告诉我。」和「新会话」。
- 发送后用户气泡显示 `S9 总结项目风险和下周计划`。
- Agent 回复显示 `S9 Agent 已整理项目风险和下周计划`。
- 回复出现后「保存为总结」按钮可点击。
- 保存弹窗标题为「保存为总结」，标题输入框 placeholder 为「为这份总结起个标题」。
- finalize accepted 后出现 toast「AI 总结生成中，已打开详情页」。
- 页面进入详情页，标题显示「S9 Agent 风险总结」。
- 详情页显示「AI 摘要」和摘要内容「S9 Agent 总结已保存」。
- 详情页正文显示「风险项需要提前暴露」。

## 反例

- Agent 未产生 assistant 回复前，不应显示可用的「保存为总结」主动作；否则空 session 也能误保存。
- 如果 SSE 没有 dispatch `done` 事件，页面会停在生成中，`S9 Agent 已整理项目风险和下周计划` 和「保存为总结」不会出现，case 应 timeout 暴露。
- 如果保存接口返回缺失 `task_id`，前端不应跳详情；本 case 会因找不到「S9 Agent 风险总结」而失败。
- 全程不应显示「创建失败」或「加载失败」。

## 视觉基准

不建 pixel baseline；用实际中文文案、toast、弹窗和详情正文断言 Agent 主路径结构。

## 摸清依据

- `packages/dmworksummary/src/module.tsx:122`: `/summary` 路由真实挂载 `SummaryListPage`；`module.tsx` NavRail「智能总结」`onPress` 进入列表页并把右栏 `replaceToRoot` 为新建总结页（默认 `initialMode="normal"`，取代欢迎占位页）。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:559`: `handleCreate(mode)` 对非 onCreateNew 路径推入 `SummaryCreatePage`（`initialMode` 透传模式）；空态入口也汇聚于此。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx`: 列表页 header 为单一「+」按钮（`listModeSwitch`）——点击只弹下拉（快速总结 / Agent 总结，`listNormalTab`/`listAgentTab`），不再有独立的主按钮 + 箭头组合。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:76,145,327`: `initialMode="agent"` 时 mount 调用 `enterAgentMode()` 恢复历史 session 并回显。
- `packages/dmworksummary/src/components/AgentChatPanel.tsx:159`: 发送时调用 `agentChatStream()`。
- `packages/dmworksummary/src/components/AgentChatPanel.tsx:421`: 有 assistant 输出后渲染「保存为总结」按钮。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx`: `handleSaveAsSummary()` 调用 `saveAgentSummaryViaFinalize()`。
- `packages/dmworksummary/src/api/summaryApi.ts`: `saveAgentSummaryViaFinalize()` 优先请求 `/summary/api/v1/summaries/agent/finalize`，缺路由时回退 `/summary/api/v1/summaries/agent`。
- `packages/dmworksummary/src/api/summaryApi.ts:373`: `agentChatStream()` 请求 `/summary/api/v1/agent/chat/stream` 并消费 SSE progress/done 事件。
- `packages/dmworksummary/src/i18n/zh-CN.json:184-205`: Agent 总结、保存为总结、保存成功等实际中文文案。
