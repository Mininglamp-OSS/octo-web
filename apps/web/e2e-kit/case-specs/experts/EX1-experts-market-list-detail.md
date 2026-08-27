# EX1 Experts 市场列表与详情

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@EX1 @p1 @experts @market`

## 目标

验证从统一市场入口进入 Experts 市场后，专家列表能展示官方发布的专家条目，并能打开详情查看专家说明，再关闭详情返回列表。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "expert-market-list"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/expert-market-list.ts`
  - `GET /market/api/v1/experts` — 返回一个官方发布的专家列表投影。
  - `GET /market/api/v1/expert_categories` — 返回研发工具分类及数量。
  - `GET /market/api/v1/experts/:id` — 返回专家完整指令和配置。
  - `POST /market/api/v1/metrics/track` — 返回空成功结果，允许详情页的浏览埋点不影响 UI flow。

## 用户操作步骤

1. 打开 Experts 市场页面。
2. 查看专家列表中的发布负责人。
3. 打开该专家详情。
4. 关闭详情弹窗。

## 预期结果

- 页面显示“专家”类型导航与专家列表。
- 列表显示“发布负责人”和“官方发布”。
- 点击专家卡片后，详情弹窗显示专家名称、官方发布者和专家指令正文。
- 点击关闭后，详情弹窗消失，列表内容仍可见。

## 反例

- 如果 Experts 市场没有挂载到统一市场路由，页面不会出现专家类型导航或专家列表。
- 如果官方可见性映射错误，专家卡片或详情会显示脱敏前发布者字段，或缺少“官方发布”。
- 如果列表投影没有成功 hydrate 成详情，详情弹窗不会出现专家指令正文，case 应暴露真实详情加载问题。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言列表和详情弹窗结构。

## 摸清依据

- `packages/dmworkmcp/src/module.tsx:77-83`: 将 Experts 页面注册到 `/mcp-market/experts`。
- `packages/dmworkmcp/src/components/MarketSidebar.tsx:29-35`: 统一市场侧栏中的 Experts 入口和标签。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:159-212`: 专家列表、分类列表加载和 active kind 状态。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:376-407`: 列表总数、卡片 hydrate 和详情打开流程。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:459-478`: 专家类型导航及默认“专家”页签。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:660-790`: 列表摘要、分类筛选、专家卡片和详情弹窗挂载。
- `packages/dmworkmcp/src/api/expertService.ts:271-370`: Experts list/category/detail endpoint 和 `{data, pagination}` envelope。
- `packages/dmworkmcp/src/api/expertWire.ts:36-62`: 专家列表/详情 wire shape；`112-138`: 字段映射。
- `packages/dmworkmcp/src/components/ExpertCard.tsx:75-155`: 官方发布者卡片渲染和用户可见字段。
- `packages/dmworkmcp/src/components/ExpertDetailModal.tsx:90-176`: 详情 hydrate 后的名称、官方发布和指令内容。
- `packages/dmworkmcp/src/i18n/zh-CN.json:12-49`: 专家导航、总数、加载和错误实际文案。
