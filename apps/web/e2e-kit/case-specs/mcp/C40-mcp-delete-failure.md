# C40 MCP 删除失败反馈

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@C40 @p1 @mcp @mcp-delete`

## 目标

验证用户删除自己发布的 MCP 失败时，确认弹窗保留、错误原因可见，且条目不会从列表中消失。

## 前置条件

- 使用 `fixtures-authed` 和默认 mock IM runtime。
- Per-case handler `e2e-kit/msw-handlers/c40-mcp-delete-failure.ts`：我的 MCP 列表返回一个可管理条目，删除接口返回失败。
- 进入 `/mcp-market/mcp?sid=e2etest` 并切换到“我的”。

## 用户操作步骤

1. 打开 MCP 市场并切换到“我的”。
2. 在“Delete Failure MCP”卡片上点击删除。
3. 在确认弹窗中点击“删除”。
4. 观察删除结果。

## 预期结果

- 确认弹窗显示“删除失败”。
- 弹窗仍保持打开，用户可以取消或再次尝试。
- “Delete Failure MCP”仍保留在“我的”列表中。

## 反例

- 删除失败时不应显示“已删除”。
- 删除失败时不应从列表移除该 MCP 或关闭确认弹窗。

## 视觉基准

不建 pixel baseline；使用角色、文本和卡片可见性断言结构。

## 摸清依据

- `packages/dmworkmcp/src/pages/McpMarketListPage.tsx:552-559`：我的列表的可管理权限。
- `packages/dmworkmcp/src/pages/McpMarketListPage.tsx:800-813`：可管理卡片的删除入口。
- `packages/dmworkmcp/src/components/McpDeleteConfirmModal.tsx:17-57`：删除请求失败后保留弹窗并展示错误。
- `packages/dmworkmcp/src/api/mcpService.ts:477-486`：删除接口错误映射。
- `packages/dmworkmcp/src/i18n/zh-CN.json:234-240`：删除确认、失败和成功文案。
