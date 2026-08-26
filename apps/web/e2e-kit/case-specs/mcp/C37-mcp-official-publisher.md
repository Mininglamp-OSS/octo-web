# C37 MCP 官方发布者卡片与详情

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@C37 @p1 @mcp @mcp-official`

## 目标

验证进入 MCP 市场后，官方发布者条目和普通社区条目都能正确展示；打开详情时，官方条目保持官方发布标识且不泄露后台发布者字段，普通条目展示普通发布者信息。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "mcp-official"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/mcp-official.ts`
  - `GET /market/api/v1/mcps` — 返回 1 个官方条目和 1 个社区条目。
  - `GET /market/api/v1/mcp_categories` — 返回搜索分类。
  - `GET /market/api/v1/mcps/:id` — 返回对应条目的详情、快速接入信息和工具列表。

## 用户操作步骤

1. 打开 MCP 市场的 MCP 列表页面。
2. 查看官方发布的搜索 MCP 和社区搜索 MCP 卡片。
3. 打开官方搜索 MCP 卡片，再关闭详情弹窗。
4. 打开社区搜索 MCP 卡片。

## 预期结果

- 列表同时显示 `Official Search MCP` 和 `Community Search MCP`。
- 官方卡片显示“官方发布”，不显示后台脱敏前的发布者字段；社区卡片显示发布者 `Alice`，不显示“官方发布”。
- 官方详情弹窗可打开，显示名称和“官方发布”，不显示后台脱敏前的发布者字段。
- 关闭官方详情后，详情弹窗消失；再次打开社区详情时显示社区名称和 `Alice`，不显示“官方发布”。

## 反例

- 如果官方条目被普通发布者分支渲染，官方卡片或详情会出现后台发布者字段，或缺少“官方发布”。
- 如果详情关闭状态没有清理，关闭官方详情后弹窗仍存在，或打开社区卡片仍显示官方条目内容。
- 如果 case handler 未启用，列表不会同时出现两个固定名称，sanity check 应先暴露页面未准备好而不是静默通过。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言卡片和详情弹窗结构。

## 摸清依据

- `packages/dmworkmcp/src/module.tsx:71-88`: 注册 `/mcp-market/mcp` 路由和 MCP 市场模块入口。
- `packages/dmworkmcp/src/pages/McpMarketListPage.tsx:560-585`: MCP 列表页和搜索区域入口。
- `packages/dmworkmcp/src/pages/McpMarketListPage.tsx:793-835`: 列表卡片点击后设置详情 ID，并挂载详情弹窗。
- `packages/dmworkmcp/src/components/McpCard.tsx:99-170`: 官方发布者和普通发布者的卡片渲染分支。
- `packages/dmworkmcp/src/components/McpDetailModal.tsx:134-160`: 根据条目 ID 加载详情；`319-335`: 详情弹窗及关闭回调。
- `packages/dmworkmcp/src/api/mcpService.ts:502-578`: 列表 wire shape 与 `mcp_id`、`visibility`、`creator_name` 字段映射。
- `apps/web/e2e-kit/msw-handlers/mcp-official.ts:14-77`: 本 case 使用的列表与详情 mock shape。
- `packages/dmworkmcp/src/i18n/zh-CN.json:184-185`: 官方发布者实际文案为“官方发布”。
