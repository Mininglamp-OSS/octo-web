# SK5 Skills 市场加载失败

## Metadata

- Case 类型: 边界断言
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@SK5 @p1 @skills @market @error`

## 目标

验证 Skills 市场首屏接口失败时，页面显示明确的加载错误态和重试入口，不把失败状态误显示为空列表或正常结果。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "skill-market-error"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/skill-market-error.ts`
  - `GET /api/v1/skill_categories` — 返回 503。
  - `GET /api/v1/skills` — 返回 503。

## 用户操作步骤

1. 打开 Skills 市场页面。
2. 等待首屏加载结束。

## 预期结果

- 页面显示“加载失败”。
- 页面显示“重试”按钮。
- 页面不显示任何技能卡片，也不显示正常结果摘要“共 ... 个技能”。

## 反例

- 如果错误被误判为空结果，页面会显示“暂无数据”而不是加载失败。
- 如果错误状态没有提供恢复入口，“重试”按钮不会出现。
- 如果错误后保留了旧列表，页面会同时出现错误提示和技能卡片。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言错误态、按钮和列表结构。

## 摸清依据

- `packages/dmworkskillmarket/src/hooks/useSkills.ts:44-122`: 分类或技能请求失败后设置 `error` 并结束 loading。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:329-348`: 加载失败 UI、错误文案和重试入口渲染。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:351-366`: 错误态与空态/列表态互斥渲染。
- `packages/dmworkskillmarket/src/api/skillApiReal.ts:335-363`: Skills 列表及分页 envelope 请求入口。
- `packages/dmworkskillmarket/src/i18n/zh-CN.json:35-47`: 加载失败、重试、空态和总数实际文案。
