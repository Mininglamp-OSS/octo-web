# S10 Summary Agent Reference Side Panel

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S10 @p1 @summary @agent @summary-agent @summary-reference`

## 目标

验证用户在「Agent 总结」模式里能引用一份已有 Agent 总结，并通过引用卡片打开右侧对照面板查看原总结内容。这条 case 守护 Agent 总结迭代链路的关键前置能力：引用选择器、引用卡片、右侧 SidePanel 预览和移除引用。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- baseline MSW handler 已覆盖 app shell / chat bootstrap 所需接口。
- Per-case MSW handler: `e2e-kit/msw-handlers/s10-summary-agent-reference-side-panel.ts`
  - `GET */summary/api/v1/summaries` — 普通列表入口返回空；引用选择器（status=3=COMPLETED）返回已完成 Agent 总结 `S10 已有客户总结`。
  - `GET */summary/api/v1/summaries/10010` — 返回引用总结详情，包含正文 `历史风险需要继续跟进`。
  - `GET */summary/api/v1/summaries/10010/personal` — 兜底返回个人结果，供 side panel 在团队正文为空时 fallback。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表和 `custom_template_limit`，供创建页 mount。
- 不需要 mock-im-runtime seed；本 case 只验证 Agent 引用 UI，不依赖真实聊天消息。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在空态点击「创建第一份总结」进入创建页。
3. 点击模式切换里的「Agent 总结」。
4. 点击「引用总结」打开引用选择器。
5. 在「选择要引用的总结」弹窗中点击 `S10 已有客户总结`。
6. 点击顶部引用卡片，打开右侧对照面板。
7. 点击引用卡片里的 `✕` 移除引用。

## 预期结果

- Agent 模式显示欢迎语「你好，我是总结助手，想总结什么尽管告诉我。」。
- 未选择引用时显示入口「引用总结」。
- 点击后弹窗标题显示「选择要引用的总结」，列表显示 `S10 已有客户总结`。
- 选择后顶部显示「已引用」和 `S10 已有客户总结`。
- 点击引用卡片后右侧对照面板显示标题 `S10 已有客户总结`。
- 右侧对照面板显示提示「以下内容为该总结的最新版本」和正文 `历史风险需要继续跟进`。
- 点击 `✕` 移除后，引用卡片消失，重新显示「引用总结」入口。

## 反例

- 如果引用选择器未返回可引用总结，弹窗会显示「还没有可引用的总结」，case 应因找不到 `S10 已有客户总结` 失败。
- 如果 SidePanel 漏 mock 详情接口，面板会显示「加载失败」或 sanityCheck 报 401，case 应失败。
- 移除引用后不应继续显示 `S10 已有客户总结` 引用卡片；否则后续 Agent 问答会误带旧引用上下文。

## 视觉基准

不建 pixel baseline；用实际中文文案、引用卡片和右侧对照面板内容断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:845`: `renderReferenceHeader()` 渲染「引用总结」入口和已引用卡片。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:1064`: Agent 模式渲染 `AgentChatPanel`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:1087`: 已选引用且 sidePanelOpen 时渲染 `SummaryReferenceSidePanel`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:1093`: 创建页挂载 `SummaryReferencePicker`。
- `packages/dmworksummary/src/components/SummaryReferencePicker.tsx:84`: 引用选择器调用 `listSummaries()` 带 `status=COMPLETED`，兼容模式下带 `trigger_type=AGENT`。
- `packages/dmworksummary/src/components/SummaryReferencePicker.tsx:107`: 引用选择器只保留可引用总结（`referenceable` 或 legacy `trigger_type === AGENT`）。
- `packages/dmworksummary/src/components/SummaryReferenceSidePanel.tsx:75`: 右侧对照面板加载 `getSummaryDetail()`。
- `packages/dmworksummary/src/components/SummaryReferenceSidePanel.tsx:87`: 团队正文为空时 fallback 到 `getPersonalResult()`。
- `packages/dmworksummary/src/i18n/zh-CN.json:607-618`: 引用选择器、引用卡片和预览提示实际中文文案。
