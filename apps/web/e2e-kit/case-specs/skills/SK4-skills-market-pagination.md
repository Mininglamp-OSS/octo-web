# SK4 Skills 市场分页追加

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@SK4 @p1 @skills @market @pagination`

## 目标

验证 Skills 市场首屏分页返回下一页游标时，列表通过真实页面底部哨兵继续加载，并把下一页技能追加到当前列表，而不是替换首屏内容。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "skill-market-pagination"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/skill-market-pagination.ts`
  - `GET /api/v1/skill_categories` — 返回开发工具分类，数量为 2。
  - `GET /api/v1/skills` — 首次返回发布风险雷达及 `next_cursor=page-2`；携带 `cursor=page-2` 时返回会议纪要整理并结束分页。

## 用户操作步骤

1. 打开 Skills 市场页面。
2. 查看首屏的发布风险雷达。
3. 等待页面底部继续加载下一页。

## 预期结果

- 首屏显示“release-risk-radar”，并最终追加显示“meeting-note-cleaner”。
- 首屏技能在加载下一页后仍然可见，两个技能同时保留在列表中。
- 分页过程中不显示“加载失败”。

## 反例

- 如果分页响应替换了当前列表，加载完成后“release-risk-radar”会消失。
- 如果没有继续传递下一页游标，第二个技能不会出现。
- 如果分页结果被误判为错误，页面会显示“加载失败”或重试状态。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言技能卡片结构。

## 摸清依据

- `packages/dmworkskillmarket/src/hooks/useSkills.ts:38-89`: 首页与带游标分页请求、分页结果和列表追加逻辑。
- `packages/dmworkskillmarket/src/hooks/useSkills.ts:176-187`: `hasMore` 与 `loadMore` 状态入口。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:145-160`: `IntersectionObserver` 观察底部哨兵并触发继续加载。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:329-366`: 加载中、错误和技能列表 UI 状态。
- `packages/dmworkskillmarket/src/api/skillApiReal.ts:335-363`: Skills 分页请求参数及 `{data, pagination.next_cursor}` envelope。
- `packages/dmworkskillmarket/src/types/skill.ts:163-190`: `PagedResult` 与分页响应字段定义。
- `packages/dmworkskillmarket/src/i18n/zh-CN.json:35-47`: 总数、继续加载和加载失败实际文案。
