# S12 Summary Agent Save Failure

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S12 @p1 @summary @agent @summary-agent @summary-create @error-state`

## 目标

验证 Agent 总结已有对话产出时，如果「保存为总结」接口返回业务失败，页面不会跳转详情，也不会清空当前对话和引用状态。这条 case 守护 Agent 保存失败时“不丢用户上下文”的回归。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s12-summary-agent-save-failure.ts`
  - `GET */summary/api/v1/summaries` — 初始返回空列表。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表和 `custom_template_limit`。
  - `POST */summary/api/v1/agent/chat/stream` — 返回 done 事件，reply 为 `S12 Agent 已生成可保存内容`。
  - `POST */summary/api/v1/summaries/agent` — 返回 `{code:40004,message:"当前对话还没有可保存的总结，请先与 AI 对话产出内容",data:null}`。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」，进入总结列表页（空态）。
2. 点击列表页右上角「+」下拉，选择「Agent 总结」直接进入 Agent 会话。
3. 发送 `S12 生成保存失败测试内容`。
5. 等待 Agent 回复后点击「保存为总结」。
6. 在保存弹窗输入 `S12 保存失败总结` 并点击「确定」。

## 预期结果

- Agent 回复显示 `S12 Agent 已生成可保存内容`。
- 点击保存后出现错误 toast「当前对话还没有可保存的总结，请先与 AI 对话产出内容」。
- 页面仍停留在 Agent 工作台，用户气泡 `S12 生成保存失败测试内容` 仍可见。
- assistant 气泡 `S12 Agent 已生成可保存内容` 仍可见。
- 不出现详情标题 `S12 保存失败总结`。
- 不显示「AI 总结已保存」。

## 反例

- 如果 `createAgentSummary()` 未校验业务 `code`，会误报保存成功并跳详情；本 case 会因仍期望对话气泡存在、且不期望详情标题出现而失败。
- 如果失败分支清空 chat session，用户气泡或 assistant 气泡会消失，case 应失败。
- 如果失败后被 401 踢登录，sanityCheck 应报出 URL 在 `/login`。

## 视觉基准

不建 pixel baseline；用 toast、工作台气泡和未跳详情断言失败态。

## 摸清依据

- `packages/dmworksummary/src/api/summaryApi.ts:307`: `createAgentSummary()` 显式校验 envelope `code` 和 `task_id`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:891`: `handleSaveAsSummary()` 调用 `createAgentSummary()`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:972`: 保存失败 catch 分支保留当前 chat state。
- `packages/dmworksummary/src/components/AgentChatPanel.tsx:421`: 有 assistant 输出后渲染「保存为总结」按钮。
- `packages/dmworksummary/src/i18n/zh-CN.json:203`: 无可保存产出的错误文案。
