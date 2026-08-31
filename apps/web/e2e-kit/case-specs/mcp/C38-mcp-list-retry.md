# C38: MCP 列表加载失败后重试

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@C38 @p1 @mcp @mcp-retry`

## 目标

验证 MCP 市场列表加载失败时提供重试入口，重试成功后展示列表内容。

## 前置条件

- 使用 `fixtures-authed.ts` 和 mock IM runtime。
- Per-case handler `e2e-kit/msw-handlers/c38-mcp-list-retry.ts`：MCP 列表首次返回 500，重试后返回一个真实列表 shape。

## 用户操作步骤

1. 打开 MCP 市场列表。
2. 观察加载失败提示和「重试」。
3. 点击「重试」。

## 预期结果

- 页面显示「加载连接器失败」和「重试」。
- 重试后显示「Retryable Search MCP」。
- 重试后错误提示消失。

## 反例

- 加载失败后没有恢复入口，或重试后仍停留在错误状态。

## 视觉基准

不建 pixel baseline；用用户可见文本和按钮断言。

## 摸清依据

- `packages/dmworkmcp/src/pages/McpMarketListPage.tsx:299-326`: 列表加载失败进入 error 状态并保留重试能力。
- `packages/dmworkmcp/src/pages/McpMarketListPage.tsx:773-778`: error 状态渲染标题、错误文案和重试按钮。
- `packages/dmworkmcp/src/api/mcpService.ts:637-690`: `/mcps` 与 `/mcp_categories` 的响应 shape。
- `packages/dmworkmcp/src/i18n/zh-CN.json:133-150`: MCP 列表错误和重试文案。
