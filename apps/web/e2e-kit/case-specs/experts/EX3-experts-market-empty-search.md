# EX3 Experts 市场无匹配空态

## Metadata

- Case 类型: 边界断言
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@EX3 @p1 @experts @market @empty`

## 目标

验证 Experts 市场搜索没有匹配项时，页面显示明确空态，不把业务空结果误显示为加载失败，也不保留过期的专家卡片。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "expert-market-empty"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/expert-market-empty.ts`
  - `GET /market/api/v1/experts` — 返回两个可搜索专家条目，关键词“不存在”由页面客户端筛选为空。
  - `GET /market/api/v1/expert_categories` — 返回两个专家分类及数量。

## 用户操作步骤

1. 打开 Experts 市场页面。
2. 在“搜索专家”输入框中输入“不存在”。
3. 观察筛选结果。

## 预期结果

- 初始页面显示“发布负责人”和“会议协调专家”。
- 搜索“不存在”后，页面显示“没有找到匹配内容”及提示文案。
- 原专家卡片从列表中消失，并显示“清除筛选”按钮。
- 页面不显示“加载失败，请稍后重试。”。

## 反例

- 如果空结果沿用了旧列表状态，搜索后仍会显示原专家卡片。
- 如果空结果被错误归类为请求失败，页面会显示加载失败提示或错误重试状态。
- 如果搜索结果清空但没有保留可恢复入口，“清除筛选”按钮不会出现。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言空态、按钮和列表结构。

## 摸清依据

- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:300-325`: 专家列表按关键词、分类和标签计算可见条目。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:745-785`: 加载、错误、结果列表和无匹配空态的 UI 分支。
- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx:500-514`: 专家搜索框实际 placeholder 和输入入口。
- `packages/dmworkmcp/src/api/expertService.ts:271-308`: Experts 列表和分页 envelope。
- `packages/dmworkmcp/src/api/expertWire.ts:36-62`: 专家列表 wire shape。
- `packages/dmworkmcp/src/i18n/zh-CN.json:17-49`: 搜索、空态、加载失败和清除筛选实际文案。
