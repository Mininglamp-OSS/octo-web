# CH35 — 最近与关注 Tab 数据隔离

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CH35 @p1 @chat @sidebar @follow`

## 目标

验证最近 Tab 中未关注的会话不会泄漏到关注 Tab。

## 前置条件

- `fixtures-authed` 已登录。
- IM seed 返回一个关注群和一个仅最近会话；`/sidebar/sync` 返回关注数据。

## 用户操作步骤

1. 打开会话页。
2. 确认最近 Tab 同时展示两个会话。
3. 点击「关注」Tab。

## 预期结果

- 页面显示关注群，但不显示最近 Tab 中未关注的会话。

## 反例

- 关注 Tab 不应错误显示整理空态或最近 Tab 中未关注的会话。

## 视觉基准

不建 pixel baseline；用 `getByText` 断言结构。

## 摸清依据

- `packages/dmworkbase/src/Hooks/useFollowSidebar.ts`
- `packages/dmworkbase/src/Components/ChatConversationList/index.tsx`
- `packages/dmworkbase/src/Pages/Chat/index.tsx`
