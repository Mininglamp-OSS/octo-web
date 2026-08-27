# EX4 Experts 市场分页上限提示

## Metadata

- Case 类型: 边界断言
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@EX4 @p1 @experts @market @pagination`

## 目标

验证 Experts 市场目录总量超过单页上限时，页面保留首批目录内容，并显示明确的截断提示，避免用户误以为已加载完整目录。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "expert-market-truncated"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/expert-market-truncated.ts`
  - `GET /api/v1/experts` — 返回首批 100 个专家，分页 envelope 的真实总数为 101。
  - `GET /api/v1/expert_categories` — 返回研发工具分类，总数为 101。

## 用户操作步骤

1. 打开 Experts 市场页面。
2. 查看目录列表和结果提示。

## 预期结果

- 首批目录中的“发布负责人”正常显示。
- 页面显示“仅显示前 100 项，请用搜索或分类筛选缩小范围”。
- 页面不显示“加载失败，请稍后重试。”。

## 反例

- 如果超过单页上限没有提示，用户无法知道当前目录并不完整。
- 如果首批响应被误判为错误，页面会显示加载失败提示或重试状态。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言截断提示和专家卡片结构。

## 摸清依据

- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:34-38`: Experts 目录单页上限为 100。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:367-380`: 真实总数、已加载数量和截断状态计算。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:738-758`: 结果摘要与截断提示 UI 渲染。
- `packages/dmworkmcp/src/api/expertService.ts:271-304`: Experts 列表请求默认 `page_size=100` 和分页 envelope 映射。
- `packages/dmworkmcp/src/api/expertWire.ts:36-62`: 专家列表 wire shape。
- `packages/dmworkmcp/src/i18n/zh-CN.json:36-49`: 总数、截断提示和加载失败实际文案。
