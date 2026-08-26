# CH37 — 转发消息完成发送

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CH37 @p1 @chat @forward`

## 目标

验证从消息菜单打开转发面板，选择目标会话并完成发送。

## 前置条件

- seed 一条历史文本消息和一个可选目标群。
- 转发目标候选来自当前本地会话数据。

## 用户操作步骤

1. 右键历史消息并点击「转发」。
2. 在转发面板切换到「全部群聊」。
3. 选择目标群并点击「确认(1)」。

## 预期结果

- 转发面板关闭，发送流程完成。

## 反例

- 未选择目标时确认按钮应保持不可用，不能关闭面板或误发消息。

## 视觉基准

不建 pixel baseline；用 `getByText` 与按钮状态断言结构。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/index.tsx`
- `packages/dmworkbase/src/Components/ConversationSelect/index.tsx`
- `packages/dmworkbase/src/Components/ForwardModal/ForwardModal.tsx`
