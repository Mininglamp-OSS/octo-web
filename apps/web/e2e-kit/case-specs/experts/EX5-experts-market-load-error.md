# EX5 Experts 市场加载失败

## Metadata

- Case 类型: 边界断言
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@EX5 @p1 @experts @market @error`

## 目标

验证 Experts 市场目录接口返回服务端错误时，页面显示可理解的服务不可用提示和重试入口，不把错误状态误显示为空列表或正常目录。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "expert-market-error"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/expert-market-error.ts`
  - `GET /api/v1/experts` — 返回 503。
  - `GET /api/v1/expert_categories` — 返回 503。

## 用户操作步骤

1. 打开 Experts 市场页面。
2. 等待首屏加载结束。

## 预期结果

- 页面显示“服务暂时不可用，请稍后重试”。
- 页面显示“重试”按钮。
- 页面不显示专家卡片，也不显示正常结果摘要“共 ... 个”。
- 页面不显示“没有找到匹配内容”空态。

## 反例

- 如果服务端错误被误判为空结果，页面会显示空态而不是服务不可用提示。
- 如果错误状态没有恢复入口，“重试”按钮不会出现。
- 如果错误后保留旧列表，页面会同时出现错误提示和专家卡片。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言错误态、按钮和列表结构。

## 摸清依据

- `packages/dmworkmcp/src/api/expertListError.ts:1-28`: 5xx 响应分类为 server 错误并映射到 `mcp.list.error.server`。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:188-214`: Experts 列表和分类加载失败后设置错误状态。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:741-790`: 加载、错误、空态和列表 UI 分支及重试入口。
- `packages/dmworkmcp/src/api/expertService.ts:271-304`: Experts 列表请求及 `{data, pagination}` envelope。
- `packages/dmworkmcp/src/i18n/zh-CN.json:136-148`: 服务错误、重试和空态实际文案。
