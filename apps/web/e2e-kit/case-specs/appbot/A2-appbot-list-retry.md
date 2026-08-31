# A2: 应用列表加载失败后重试

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@A2 @p1 @appbot @appbot-retry`

## 目标

验证应用列表首次加载失败时展示恢复入口，用户点击重试后能够看到应用列表。

## 前置条件

- 使用 `fixtures-authed.ts` 提供登录态、中文语言和 mock IM runtime。
- Per-case handler `e2e-kit/msw-handlers/a2-appbot-list-retry.ts`：应用列表首次返回 500，重试后返回一个平台应用。

## 用户操作步骤

1. 从导航栏进入「应用」页面。
2. 观察「加载失败」和「重试」。
3. 点击「重试」。

## 预期结果

- 页面显示「加载失败」和「重试」。
- 重试后显示「文档助手」。
- 重试后不再显示「加载失败」。

## 反例

- 首次失败后没有恢复入口，或重试后仍停留在错误状态。

## 视觉基准

不建 pixel baseline；用用户可见文本和按钮断言。

## 摸清依据

- `packages/dmworkappbot/src/bridge/useAppBots.ts:13-38`: 加载异常进入 error 状态，重试重新执行加载。
- `packages/dmworkappbot/src/ui/AppBotListView/index.tsx:55-66`: error 状态渲染错误文案和重试按钮。
- `packages/dmworkappbot/src/Service/AppBotService.ts:18-25`: `GET /app_bot/available` 和 `AppBotInfo` shape。
- `packages/dmworkappbot/src/i18n/zh-CN.json:2,11`: 重试和加载失败文案。
