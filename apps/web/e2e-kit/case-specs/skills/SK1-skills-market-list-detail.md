# SK1 Skills 市场列表与详情

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@SK1 @p1 @skills @market`

## 目标

验证从统一市场入口进入 Skills 市场后，技能列表能展示官方发布的技能条目，并能打开详情查看技能说明，再关闭详情返回列表。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "skill-market-list"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/skill-market-list.ts`
  - `GET /api/v1/skill_categories` — 返回开发工具分类。
  - `GET /api/v1/skills` — 返回一个官方发布的技能条目。
  - `GET /api/v1/skills/:id` — 返回技能详情。
  - `GET /api/v1/skills/:id/skill_md` — 返回详情页展示的 Markdown 内容。
  - `POST /api/v1/metrics/track` — 返回空成功结果，允许详情页的浏览埋点不影响 UI flow。

## 用户操作步骤

1. 打开 Skills 市场页面。
2. 查看技能列表中的发布风险雷达。
3. 打开该技能详情。
4. 关闭详情弹窗。

## 预期结果

- 页面显示 Skills 市场导航与技能列表。
- 列表显示“发布风险雷达”、技能名 `release-risk-radar` 和“官方发布”。
- 点击技能卡片后，详情弹窗显示技能名称、官方发布者和技能说明正文。
- 点击关闭后，详情弹窗消失，列表内容仍可见。

## 反例

- 如果 Skills 市场没有挂载到统一市场路由，页面不会出现 Skills 导航或技能列表。
- 如果列表响应映射错误，官方技能卡片不会同时出现展示名称、技能名和“官方发布”。
- 如果详情请求或 SKILL.md 请求失败，详情正文不会出现，case 应暴露真实的详情加载问题。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言列表和详情弹窗结构。

## 摸清依据

- `packages/dmworkmcp/src/module.tsx:69-77`: 将 Skills 页面注册到 `/mcp-market/skills`。
- `packages/dmworkmcp/src/components/MarketSidebar.tsx:24-35`: 统一市场侧栏中的 Skills 入口和标签。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:36-54`: 列表页状态、查询 hook 和详情 ID。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:183-205`: Skills 列表摘要与官方市场内容入口。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:332-367`: 技能卡片列表与详情弹窗挂载。
- `packages/dmworkskillmarket/src/hooks/useSkills.ts:33-89`: 分类和技能列表请求及分页响应映射。
- `packages/dmworkskillmarket/src/api/skillApiReal.ts:324-363`: `skill_categories`、`skills` endpoint 和分页 envelope。
- `packages/dmworkskillmarket/src/components/SkillCard.tsx:112-230`: 官方发布者卡片文案和技能名称渲染。
- `packages/dmworkskillmarket/src/components/SkillDetailModal.tsx:134-189`: 详情加载、SKILL.md 内容加载和错误处理。
- `packages/dmworkskillmarket/src/i18n/zh-CN.json:17-47`: 列表、搜索、总数和详情实际中文文案。
