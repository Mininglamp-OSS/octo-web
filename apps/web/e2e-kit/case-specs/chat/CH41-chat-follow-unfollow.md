# CH41 — 取消关注会话

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CH41 @p1 @chat @sidebar @follow`
- Implementation: `apps/web/e2e-kit/tests/chat/chat-layout-coverage.spec.ts`

## 目标

验证用户从关注 Tab 的会话菜单执行取消关注后，该会话从关注列表移除。

## 前置条件

- 用户已登录并打开 Chat。
- sidebar 返回一个已关注群。
- 取消关注接口成功，后续 sidebar reload 返回空关注列表。

## 用户操作步骤

1. 打开 Chat 并切换到关注 Tab。
2. 对已关注群打开右键菜单。
3. 点击「取消关注」。

## 预期结果

- 已关注群从关注列表消失。

## 反例

- 取消关注请求成功后，群仍留在关注列表，或列表刷新又错误恢复为已关注状态，说明 UI 与 sidebar 状态没有完成同步。

## 视觉基准

不建 pixel baseline；使用用户可见列表项断言。

## 摸清依据

- `packages/dmworkbase/src/Components/ConversationListGrouped/index.tsx`
- `packages/dmworkbase/src/Service/FollowService.ts`
