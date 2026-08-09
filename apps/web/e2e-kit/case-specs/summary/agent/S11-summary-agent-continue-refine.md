# S11 Summary Agent Continue Refine

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0
- Tags: `@S11 @p0 @summary @agent @summary-agent @summary-detail @summary-reference`

## 目标

验证用户从已保存的 Agent 总结详情页点击「继续优化」后，会打开新的 Agent 总结工作台，并自动引用当前总结；用户可点击引用卡片打开右侧对照面板查看原总结内容。这条 case 守护 Agent 总结从“交付物”进入“迭代工作台”的 P0 路径。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- baseline MSW handler 已覆盖 app shell / chat bootstrap 所需接口。
- Per-case MSW handler: `e2e-kit/msw-handlers/s11-summary-agent-continue-refine.ts`
  - `GET */summary/api/v1/summaries` — 返回一条已完成 Agent 总结 `S11 Agent 原总结`。
  - `GET */summary/api/v1/summaries/11011` — 返回对应详情，`trigger_type=3` 且包含正文 `S11 原总结风险清单`。
  - `POST */summary/api/v1/summaries/11011/read`、`GET */summary/api/v1/summaries/11011/versions` — 详情页后续请求兜底。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表和 `custom_template_limit`，供继续优化打开创建页时 mount。
- 不需要 mock-im-runtime seed；本 case 只验证详情页入口、Agent 模式和引用预览。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击 `S11 Agent 原总结` 打开详情。
3. 点击详情页头部「继续优化」。
4. 在新打开的 Agent 总结工作台查看自动引用卡片。
5. 点击引用卡片打开右侧对照面板。

## 预期结果

- 列表页显示 `S11 Agent 原总结`。
- 详情页显示标题 `S11 Agent 原总结` 和「继续优化」按钮。
- 点击「继续优化」后，创建页显示「Agent 总结」模式、欢迎语「你好，我是总结助手，想总结什么尽管告诉我。」。
- 顶部显示「已引用」和 `S11 Agent 原总结`。
- 点击引用卡片后，右侧对照面板显示标题 `S11 Agent 原总结`。
- 右侧对照面板正文显示 `S11 原总结风险清单`。

## 反例

- 如果详情页 `trigger_type` 不是 Agent，页面不应显示「继续优化」；本 case 会因找不到按钮失败。
- 如果继续优化没有把当前 task 作为 `derivedFromTask` 传给创建页，Agent 工作台不会显示「已引用」卡片，case 应失败。
- 如果引用侧栏漏 mock 详情接口，右侧面板会显示「加载失败」或 sanityCheck 报 401。

## 视觉基准

不建 pixel baseline；用实际中文文案、详情按钮、引用卡片和右侧对照面板内容断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2191`: `handleContinueRefine()` 派发 `summary-open-chat-with-reference` 事件。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3920`: Agent completed 详情页渲染「继续优化」按钮。
- `packages/dmworksummary/src/module.tsx:131`: 模块监听 `summary-open-chat-with-reference` 并打开 `SummaryCreatePage derivedFromTask`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:291`: `derivedFromTask` mount 时自动切 Agent 模式、清旧 session、预填引用。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:845`: `renderReferenceHeader()` 渲染「已引用」卡片。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:1087`: 点击引用卡片后渲染 `SummaryReferenceSidePanel`。
- `packages/dmworksummary/src/components/SummaryReferenceSidePanel.tsx:75`: 右侧对照面板调用 `getSummaryDetail()` 加载原总结内容。
