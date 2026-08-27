# A3 Appbot 连接失败反馈

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@A3 @p1 @appbot @appbot-connect`

## 目标

验证应用列表中的 Appbot 连接失败时，用户看到明确的失败提示，列表页面和当前选择状态保持可恢复。

## 前置条件

- 使用 `fixtures-authed` 和默认 mock IM runtime。
- Per-case handler `e2e-kit/msw-handlers/a3-appbot-connect-failure.ts`：返回一个可见 Appbot，并让 `/api/v1/app_bot/apply` 返回失败。
- 进入应用页面。

## 用户操作步骤

1. 打开“应用”页面。
2. 点击“文档助手”。
3. 观察连接结果。

## 预期结果

- 页面显示“无法连接到该应用，请稍后重试”。
- 应用列表仍保持显示“文档助手”，用户可以再次点击重试。
- 不应进入 Appbot 对话页面，且应用列表页面仍保持可见。

## 反例

- 连接失败被当作成功时，不应出现 Appbot 对话头部或离开应用列表。
- 失败后不应从列表移除“文档助手”。

## 视觉基准

不建 pixel baseline；使用角色、文本和页面标题断言用户可观察结构。

## 摸清依据

- `packages/dmworkappbot/src/AppBotPage.tsx:8-37`：应用页面装配列表和连接失败文案。
- `packages/dmworkappbot/src/bridge/useAppBots.ts:20-52`：可用应用列表加载与失败恢复状态。
- `packages/dmworkappbot/src/features/appBotConversation.tsx:79-128`：选择应用、调用连接和失败提示逻辑。
- `packages/dmworkappbot/src/Service/AppBotService.ts:20-30`：`GET /app_bot/available` 与 `POST /app_bot/apply` 接口。
- `packages/dmworkappbot/src/i18n/zh-CN.json:1-8`：连接失败用户文案。
