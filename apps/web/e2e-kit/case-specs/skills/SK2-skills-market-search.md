# SK2 Skills 市场搜索

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@SK2 @p1 @skills @market @search`

## 目标

验证在 Skills 市场输入技能名称或描述关键词后，列表和结果总数会更新为匹配结果，并隐藏不匹配的技能。

## 前置条件

- fixture: `fixtures-authed`，使用本地 mock 登录和 mock IM runtime。
- 页面初始化前设置 `sessionStorage.__e2e_scenario = "skill-market-search"`，启用本 case 的 MSW handler。
- Per-case MSW handler: `e2e-kit/msw-handlers/skill-market-search.ts`
  - `GET /api/v1/skill_categories` — 根据 `q` 返回匹配结果分类数量。
  - `GET /api/v1/skills` — 根据 `q` 返回两个初始技能或一个风险相关技能。

## 用户操作步骤

1. 打开 Skills 市场页面。
2. 在“搜索名称、描述...”输入框中输入“发布”。
3. 等待列表完成筛选。

## 预期结果

- 初始列表显示 2 个技能。
- 输入“发布”后，列表重新筛选：仅保留“发布风险雷达”，隐藏“会议纪要整理”。

## 反例

- 如果搜索输入没有触发列表刷新，两个技能仍全部显示。
- 如果服务端筛选结果没有正确映射，匹配技能不会出现，或不匹配技能仍留在列表中。
- 关键词 debounce 期间不应因一次输入显示加载失败或跳转登录页。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言搜索框、结果摘要和卡片结构。

## 摸清依据

- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:36-54`: 列表页通过 `useSkills` 管理查询状态。
- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx:204-213`: SearchBar 的实际 placeholder 和受控输入入口。
- `packages/dmworkskillmarket/src/hooks/useSkills.ts:64-89`: 分类/技能请求完成后更新列表和总数。
- `packages/dmworkskillmarket/src/hooks/useSkills.ts:105-121`: 查询输入 debounce 300ms 后触发刷新。
- `packages/dmworkskillmarket/src/api/skillApiReal.ts:335-363`: `GET /api/v1/skills?q=...` 参数和分页 envelope。
- `packages/dmworkskillmarket/src/components/SkillCard.tsx:112-230`: 技能卡片名称、展示名称和描述渲染。
- `packages/dmworkskillmarket/src/i18n/zh-CN.json:19-47`: 搜索 placeholder、总数和列表文案。
