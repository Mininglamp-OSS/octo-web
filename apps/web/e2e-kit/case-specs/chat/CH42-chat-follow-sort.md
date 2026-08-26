# CH42 — 关注会话排序

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CH42 @p1 @chat @sidebar @follow @sort`
- Implementation: `apps/web/e2e-kit/tests/chat/chat-layout-coverage.spec.ts`

## 目标

验证关注 Tab 内同一分组的两个会话可通过拖拽调整顺序，并按新顺序展示。

## 前置条件

- 用户已登录并打开 Chat。
- 同一关注分组返回 A、B 两个群，初始顺序为 A、B。
- 排序接口根据请求 body 中的 sort items 返回成功，并按请求顺序返回 sidebar。

## 用户操作步骤

1. 打开 Chat 并切换到关注 Tab。
2. 确认会话初始顺序为 A、B。
3. 拖拽 A 到 B 的位置。

## 预期结果

- 排序请求使用拖拽后的会话顺序。
- 关注列表展示为 B、A。

## 反例

- 初始顺序不确定、拖拽不触发排序、排序 payload 未体现新顺序，或接口成功后列表仍回到 A、B，均说明关注排序主流程未闭环。

## 视觉基准

不建 pixel baseline；使用列表项位置断言。

## 摸清依据

- `packages/dmworkbase/src/Components/ConversationListGrouped/index.tsx`
- `packages/dmworkbase/src/Components/ChatConversationList/index.tsx`
- `packages/dmworkbase/src/Service/FollowService.ts`
