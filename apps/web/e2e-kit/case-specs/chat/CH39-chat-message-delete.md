# CH39 — 多选删除消息

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CH39 @p1 @chat @message-lifecycle`

## 目标

验证进入多选模式删除消息后，消息从当前消息流移除。

## 前置条件

- seed 一条历史消息。
- 删除确认接口返回成功。

## 用户操作步骤

1. 右键历史消息并点击「多选」。
2. 点击「删除」并确认。

## 预期结果

- 历史消息从当前消息流移除。

## 反例

- 取消删除确认时历史消息应继续保留在当前消息流中，不能误删。

## 视觉基准

不建 pixel baseline；用 `getByText` 断言消息流。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/index.tsx`
- `packages/dmworkdatasource/src/conversation.ts`
