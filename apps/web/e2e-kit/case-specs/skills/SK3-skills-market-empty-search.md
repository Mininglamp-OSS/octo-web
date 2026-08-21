# SK3 Skills 市场无匹配空态

## Metadata

- Case 类型: 边界断言
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@SK3 @p1 @skills @market @empty`

## 目标

验证 Skills 市场搜索没有匹配项时，页面显示明确空态，不把业务空结果误显示为加载失败，也不保留过期的技能卡片。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "skill-market-empty"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/skill-market-empty.ts`
  - `GET /api/v1/skill_categories` — 初始返回开发工具分类，搜索无匹配时返回空分类。
  - `GET /api/v1/skills` — 初始返回一个技能，关键词“ 不存在 ”返回空列表。

## 用户操作步骤

1. 打开 Skills 市场页面。
2. 在“搜索名称、描述...”输入框中输入“不存在”。
3. 等待筛选完成。

## 预期结果

- 初始页面显示“发布风险雷达”。
- 搜索“不存在”后，页面显示“暂无数据”。
- 原技能卡片从列表中消失，页面不显示“加载失败”。

## 反例

- 如果空结果沿用了旧列表状态，搜索后仍会显示“发布风险雷达”。
- 如果空结果被错误归类为请求失败，页面会显示“加载失败”或“重试”按钮。
- 如果空态只更新文字而没有清理列表，列表和摘要会表达相互矛盾的状态。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言空态和列表结构。

## 摸清依据

- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:333-367`: 加载、错误和空列表三种 UI 状态分支。
- `packages/dmworkskillmarket/src/hooks/useSkills.ts:64-89`: 空分页结果替换当前技能列表并结束 loading。
- `packages/dmworkskillmarket/src/api/skillApiReal.ts:335-363`: Skills list 的分页响应 shape。
- `packages/dmworkskillmarket/src/i18n/zh-CN.json:26-32`: “暂无数据”和加载失败实际文案。
