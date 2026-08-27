# C39 MCP 试连失败反馈

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@C39 @p1 @mcp @mcp-probe`

## 目标

验证用户在 MCP 上架向导中试连远程服务失败时，页面保留当前配置和工具空态，并展示可理解的失败原因。

## 前置条件

- 使用 `fixtures-authed` 和默认 mock IM runtime。
- Per-case handler `e2e-kit/msw-handlers/c39-mcp-probe-failure.ts`：为 MCP probe 返回 `is_ok=false`、`error.code=init_failed`，并覆盖市场首屏列表与分类接口。
- 进入 `/mcp-market/mcp?sid=e2etest`。

## 用户操作步骤

1. 打开 MCP 市场，选择“上架连接器”→“手动填写”。
2. 填写连接器名称，进入“接入配置”，填写远程服务地址。
3. 在接入配置页的工具清单区域点击“试连 / 获取工具列表”。
4. 观察试连结果和工具清单区域。

## 预期结果

- 试连失败后显示“连接配置不完整，无法探测工具列表。”。
- 工具清单仍显示空态“尚未获取工具”，没有伪造工具被加入。
- 上架向导仍保持打开，用户可以继续修改配置或重试。

## 反例

- 失败响应被当作成功时，不应出现“已获取 N 个工具”。
- 失败后不应关闭上架向导或跳转离开 MCP 市场。
- 失败后不应渲染任意工具条目。

## 视觉基准

不建 pixel baseline；用 `getByRole` + `getByText` 断言对话框、toast 和空态结构。

## 摸清依据

- `packages/dmworkmcp/src/pages/McpMarketListPage.tsx:692-739`：上架连接器入口和手动填写菜单。
- `packages/dmworkmcp/src/components/McpCreateModal.tsx:650-744`：向导步骤、probe 调用和错误 toast。
- `packages/dmworkmcp/src/components/McpCreateModal.tsx:1488-1518`：工具清单空态与试连按钮（与接入配置同一步骤）。
- `packages/dmworkmcp/src/api/mcpService.ts:722-752`：真实 probe 响应 shape 与 `is_ok`/`error.code` 映射。
- `packages/dmworkmcp/src/types/mcp.ts:170-199`：`McpProbeRequest` 和 `McpProbeResult` 类型。
- `packages/dmworkmcp/src/i18n/zh-CN.json:339-350`：试连失败和空态用户文案。
