# EX2 Experts 市场搜索

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@EX2 @p1 @experts @market @search`

## 目标

验证在 Experts 市场输入专家名称、简介或标签关键词后，列表会立即按已加载目录筛选，并同步更新结果总数。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "expert-market-search"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/expert-market-search.ts`
  - `GET /market/api/v1/experts` — 返回一个官方发布专家和一个社区专家。
  - `GET /market/api/v1/expert_categories` — 返回两个专家分类及数量。

## 用户操作步骤

1. 打开 Experts 市场页面。
2. 在“搜索专家”输入框中输入“发布”。

## 预期结果

- 初始列表显示 2 个专家。
- 输入“发布”后，列表重新筛选：仅保留“发布负责人”，隐藏“会议协调专家”。

## 反例

- 如果搜索输入没有触发客户端筛选，两个专家仍全部显示。
- 如果搜索只匹配名称而没有按页面约定覆盖简介/标签，匹配结果会错误缺失。
- 筛选过程中不应出现加载失败提示或跳转登录页。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言搜索框和卡片结构。

## 摸清依据

- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:286-322`: 专家列表按名称、简介和标签进行客户端筛选。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:376-390`: 过滤状态与结果摘要数量计算。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:500-514`: 专家搜索框实际 placeholder 和输入入口。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:660-790`: 结果摘要和专家卡片渲染。
- `packages/dmworkmcp/src/api/expertService.ts:271-308`: 专家列表请求和分页 envelope。
- `packages/dmworkmcp/src/api/expertWire.ts:36-62`: 专家列表 wire shape。
- `packages/dmworkmcp/src/components/ExpertCard.tsx:75-155`: 专家名称、简介、标签和官方发布者展示。
- `packages/dmworkmcp/src/i18n/zh-CN.json:17-39`: 搜索 placeholder、总数和筛选相关实际文案。
