# S5 Summary Create Basic

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S5 @p1 @summary @create @summary-create`

## 目标

验证用户能从「智能总结」创建页选择一个群聊、输入总结主题并提交，提交成功后看到「总结任务已创建」toast 并进入新总结详情页。这条 case 守护 Summary 创建主流程，不验证请求 body。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- Per-case MSW handler: `s5-summary-create-basic.ts`
  - `GET */summary/api/v1/summaries` — 初始返回空列表，让用户从空态进入创建页。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表和 `custom_template_limit`，供创建页 mount。
  - `GET */summary/api/v1/summary-chat-candidates` — 返回一个群聊候选 `S5 项目群`。
  - `POST */summary/api/v1/summaries` — 返回 `{task_id:9501}`。
  - `GET */summary/api/v1/summaries/9501` — 返回新建总结详情 `S5 项目复盘总结`。
  - `POST */summary/api/v1/summaries/9501/read`、`GET */summary/api/v1/summaries/9501/versions` — 详情页后续请求兜底。
- 不需要 mock-im-runtime seed；本 case 只验证 Summary real-page HTTP create flow。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在空态点击「创建第一份总结」进入创建页。
3. 点击「选择聊天」，切到「全部群聊」，选择 `S5 项目群` 并确认。
4. 在主题输入框输入 `S5 项目复盘总结`。
5. 点击「开始总结」。

## 预期结果

- 创建页显示「邀请同事一起总结信息」。
- 选择聊天后，创建页显示已选群聊 `S5 项目群`。
- 提交后出现 toast「总结任务已创建」。
- 页面进入新总结详情，显示标题「S5 项目复盘总结」。
- 详情页显示摘要「S5 创建流程已完成」。

## 反例

- 进入创建页但未选择聊天、未输入主题时，「开始总结」按钮应不可用。
- 提交成功后不应显示「创建失败」或「加载失败」。

## 视觉基准

不建 pixel baseline；用实际文案和角色/文本 locator 断言创建主流程。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryListPage.tsx:414`: `handleCreate` 将 `SummaryCreatePage` 推入右侧路由。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:574`: `handleSubmit` 组装 `CreateSummaryParams` 并调用 `api.createSummary`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:643`: 创建成功 toast 使用 `summary.create.success`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:654`: 非 embedded 创建成功后进入 `SummaryDetailPage`。
- `packages/dmworksummary/src/api/summaryApi.ts:290`: `createSummary()` 请求 `POST /summary/api/v1/summaries`。
- `packages/dmworksummary/src/api/summaryApi.ts:956`: `getChatCandidates()` 请求 `/summary-chat-candidates`。
- `packages/dmworksummary/src/types/summary.ts:285`: `CreateSummaryParams` 字段 shape。
- `packages/dmworksummary/src/types/summary.ts:591`: `ChatCandidate` 字段 shape。
- `packages/dmworksummary/src/i18n/zh-CN.json:170`: 创建页标题「邀请同事一起总结信息」。
- `packages/dmworksummary/src/i18n/zh-CN.json:178`: 创建成功 toast「总结任务已创建」。
