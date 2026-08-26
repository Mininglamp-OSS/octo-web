# S26 Summary 独立详情与分享链接

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@S26 @p1 @summary @deep-link`

## 目标

验证通知或外部入口打开 `/s/:taskNo` 与 `/s/share/:shareId` 时，应用直接渲染对应 Summary 页面，而不是回到 Summary 列表或登录页。

## 前置条件

- fixture: `fixtures-authed`，保持登录态和 `e2e-space-001`。
- Per-case MSW handler: `e2e-kit/msw-handlers/s26-summary-standalone-links.ts`
  - 详情接口返回完成态 Summary 数据。
  - 分享接口返回可展示的分享详情数据。
- 使用 mock HTTP，不写真实数据。

## 用户操作步骤

1. 打开 `/s/e2e-task-026`。
2. 观察 Summary 详情页。
3. 再打开 `/s/share/e2e-share-026`。
4. 观察分享详情页。

## 预期结果

- `/s/e2e-task-026` 显示对应 Summary 详情内容。
- `/s/share/e2e-share-026` 显示分享详情内容。
- 两个入口均不显示登录页；格式错误或嵌套路由不渲染 Summary 详情页。
- 两个入口都不显示 Chat 空态、Summary 列表或登录页。

## 反例

- `/s`、多段嵌套路由或缺少 ID 不应误渲染详情页。
- 已登录用户打开独立链接不应被重定向到登录页。

## 视觉基准

不建 pixel baseline；使用页面标题、正文和可见错误态断言结构。

## 摸清依据

- `apps/web/src/Layout/index.tsx:491-526`: 两类独立 Summary 路径的识别与渲染。
- `apps/web/src/Layout/index.tsx:96-113`: task/share 路径解析规则。
- `packages/dmworksummary/src/module.tsx:95-120`: 分享详情页面导航与 URL 结构。
