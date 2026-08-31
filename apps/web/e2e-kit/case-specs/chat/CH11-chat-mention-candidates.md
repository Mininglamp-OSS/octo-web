# CH11 Chat Mention Candidates

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed + mock IM
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH11 @p1 @chat @composer @mention`

## 目标

验证群聊输入框输入 `@` 后能展示群成员候选，保证成员同步和 composer 联想链路可用。

## 前置条件

- 使用 `fixtures-authed.ts` 和本地 mock IM。
- seed 一个群会话，并提供当前用户和「E2E Sender」两个群成员。
- seed 一条历史文本消息，确保进入真实消息流和 composer 上下文。

## 用户操作步骤

1. 打开「E2E Chat 消息群」。
2. 在消息输入框输入 `@`。
3. 观察成员候选列表。

## 预期结果

- 页面显示 mention 候选列表。
- 候选中显示「E2E Sender」。

## 反例

- 如果成员同步未完成，候选列表不会出现或只显示空成员提示。
- 如果 composer 没有接收到群成员，输入 `@` 不会产生可选成员。

## 视觉基准

不建 pixel baseline; 用 listbox/option 和可见成员名称断言结构。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/vm.ts:1228-1298`: 群成员同步与 subscribers ready 流程。
- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx:716-750`: mention suggestion 数据构造。
- `packages/dmworkbase/src/features/chat-composer/ui/suggestions/MentionList.tsx:234-295`: 候选 listbox/option 渲染契约。
