# S1 Summary List Detail

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0
- Tags: `@S1 @p0 @summary @list @summary-list @summary-detail`

## 目标

验证用户从主导航进入「智能总结」后，能在总结列表看到一条已完成总结，并点击列表卡片进入详情页阅读摘要和正文。这条 case 守护 Summary 模块的最小读链路：真实 NavRail 入口、列表加载、卡片点击、详情加载和已完成内容渲染。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- baseline MSW handler 已覆盖 app shell / chat bootstrap 所需接口。
- Per-case MSW handler: `s1-summary-list-detail.ts`
  - `GET */summary/api/v1/summaries` — 返回 `{code,message,data:{items,total}}`，其中 `items[0]` 是已完成总结 `S1 项目进展总结`。
  - `GET */summary/api/v1/summaries/9101` — 返回 `{code,message,data: SummaryDetail}`，包含 `result.abstract`、`result.content`、`sources` 和真实 permissions 字段。
  - `POST */summary/api/v1/summaries/9101/read` — 返回 `{is_unread:false,has_pending_invitation:false,needs_attention:false}`，避免详情页 mark-read 之后报错。
  - `GET */summary/api/v1/summaries/9101/versions` — 返回空版本列表，避免详情页版本按钮二次请求漏 mock。
- 不需要 mock-im-runtime seed；本 case 只验证 Summary real-page HTTP read flow。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在「智能总结」列表页观察到搜索框「搜索总结...」和总结卡片「S1 项目进展总结」。
3. 点击「S1 项目进展总结」卡片。
4. 在详情区域阅读总结标题、摘要和正文。

## 预期结果

- 列表页显示标题「智能总结」。
- 列表页出现总结卡片「S1 项目进展总结」，并显示状态「已完成」和来源「S1 项目群」。
- 点击卡片后，详情页显示标题「S1 项目进展总结」。
- 详情页显示摘要标题「AI 摘要」和摘要内容「项目整体进展稳定」。
- 详情页显示正文内容「已完成登录态接入」和「下一步补充 Summary e2e」。

## 反例

- 列表加载到 mock 数据后，不应显示空态「暂无总结记录」。
- 点击卡片进入详情后，不应显示「加载失败」或「网络连接异常，请检查网络后重试」。

## 视觉基准

不建 pixel baseline；用实际文案和角色/文本 locator 断言 Summary 读链路。

## 摸清依据

- `packages/dmworksummary/src/module.tsx:119`: `/summary` 路由真实挂载 `SummaryListPage`。
- `packages/dmworksummary/src/module.tsx:159-165`: 顶层菜单 id 为 `summary`，菜单文案来自 `summary.menu.title`。
- `packages/dmworksummary/src/api/summaryApi.ts:85`: Summary API base path 是 `/summary/api/v1`。
- `packages/dmworksummary/src/api/summaryApi.ts:102`: 后端响应包在 `{code,message,data}` envelope 中，API 层 unwrap `.data`。
- `packages/dmworksummary/src/api/summaryApi.ts:526`: 列表接口 `listSummaries()` 请求 `/summaries`。
- `packages/dmworksummary/src/api/summaryApi.ts:533`: 详情接口 `getSummaryDetail()` 请求 `/summaries/:taskId`。
- `packages/dmworksummary/src/api/summaryApi.ts:556`: 已读接口 `markSummaryRead()` 请求 `/summaries/:taskId/read`。
- `packages/dmworksummary/src/api/summaryApi.ts:692`: 已完成详情会请求 `/summaries/:taskId/versions`。
- `packages/dmworksummary/src/types/summary.ts:173`: `SummaryListItem` 列表项字段 shape。
- `packages/dmworksummary/src/types/summary.ts:205`: `SummaryDetail` 详情字段 shape。
- `packages/dmworksummary/src/i18n/zh-CN.json:149-154`: 菜单和列表标题实际文案「智能总结」。
- `packages/dmworksummary/src/i18n/zh-CN.json:157`: 搜索框实际文案「搜索总结...」。
- `packages/dmworksummary/src/i18n/zh-CN.json:163`: 空态实际文案「暂无总结记录」。
