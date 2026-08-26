# S2 Summary Empty Create Entry

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S2 @p1 @summary @list @summary-list @summary-create`

## 目标

验证 Summary 列表为空时，用户能看到「暂无总结记录」空态，并通过「创建第一份总结」进入创建页。这条 case 守护空态分支和新建入口，不验证提交创建。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- Per-case MSW handler: `s2-summary-empty-create-entry.ts`
  - `GET */summary/api/v1/summaries` — 返回 `{code,message,data:{items:[],total:0}}`。
  - `GET */summary/api/v1/summary-templates` — 返回空模板列表和 `custom_template_limit`，供创建页 mount 时加载模板。
- 不需要 mock-im-runtime seed；本 case 只验证 Summary 列表空态和创建页入口。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页观察空态「暂无总结记录」和「创建第一份总结」。
3. 点击「创建第一份总结」。
4. 在右侧创建页观察标题「邀请同事一起总结信息」和主题输入框。

## 预期结果

- 列表页显示标题「智能总结」。
- 空态显示「暂无总结记录」。
- 空态显示说明「快速生成群聊或个人工作总结，让 AI 帮你梳理重要信息」。
- 点击「创建第一份总结」后，创建页显示「邀请同事一起总结信息」。
- 创建页显示输入框 placeholder「请输入你想总结的主题，例如：总结本周项目进展、整理客户反馈要点」。

## 反例

- 空态列表不应显示任何 Summary 卡片标题。
- 点击创建入口后不应留在只有空态的列表页；应能看到创建页标题和输入框。

## 视觉基准

不建 pixel baseline；用实际文案断言空态和创建页结构。

## 摸清依据

- `packages/dmworksummary/src/module.tsx:119`: `/summary` 路由真实挂载 `SummaryListPage`。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:522`: `items.length === 0` 时渲染空态。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:539`: 空态按钮点击 `handleCreate`。
- `packages/dmworksummary/src/pages/SummaryListPage.tsx:414`: `handleCreate` 将 `SummaryCreatePage` 推入右侧路由。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:276`: 创建页 mount 时加载模板。
- `packages/dmworksummary/src/api/summaryApi.ts:863`: 模板配置接口 `getTopicTemplatesConfig()` 请求 `/summary-templates`。
- `packages/dmworksummary/src/i18n/zh-CN.json:163`: 空态标题「暂无总结记录」。
- `packages/dmworksummary/src/i18n/zh-CN.json:165`: 空态按钮「创建第一份总结」。
- `packages/dmworksummary/src/i18n/zh-CN.json:170`: 创建页标题「邀请同事一起总结信息」。
