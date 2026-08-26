# A1: 应用列表搜索

## Metadata

- Case 类型: 功能
- 目标模式: local
- 优先级: P1
- Tags: `@A1 @p1 @appbot`

## 目标

验证应用模块能够加载可用应用，并通过搜索筛选应用列表。

## 前置条件

- 使用 octo-web 本地 e2e mock 模式。
- `/app_bot/available` 返回一个平台应用和一个组织应用。

## 用户操作步骤

1. 从导航栏进入「应用」页面。
2. 确认应用列表显示平台应用和组织应用。
3. 在搜索框输入 `文档`。

## 预期结果

- 页面标题显示「应用」。
- 搜索前显示「文档助手」和「周报助手」两个应用。

## 反例

- 搜索后仅显示「文档助手」，列表按关键词过滤。
- 无应用时显示「暂无可用应用」。
- 搜索不匹配的关键词时，应显示「未找到匹配的应用」。

## 视觉基准

不建 pixel baseline.

## 摸清依据

- `packages/dmworkappbot/src/module.tsx:83-92`: `/appbot` 路由和「应用」导航菜单。
- `packages/dmworkappbot/src/Service/AppBotService.ts:21-24`: `GET /app_bot/available` 返回契约。
- `packages/dmworkappbot/src/ui/AppBotListView/index.tsx:98-118`: 页面标题、搜索框、分组列表渲染。
- `packages/dmworkappbot/src/i18n/zh-CN.json:5-10`: 中文可见文案。
