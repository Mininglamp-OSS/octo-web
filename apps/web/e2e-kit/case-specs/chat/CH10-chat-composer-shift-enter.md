# CH10 Chat Composer Shift Enter

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH10 @p1 @chat @composer`

## 目标

验证用户在消息输入框按 Shift+Enter 时插入换行，而不是立即发送消息。

## 前置条件

- 使用 `fixtures-authed.ts` 和本地 mock IM。
- seed 一个可打开的群会话。

## 用户操作步骤

1. 打开「E2E Chat 消息群」。
2. 输入「第一行」。
3. 按 Shift+Enter，再输入「第二行」。

## 预期结果

- 输入框同时保留「第一行」和「第二行」。
- Shift+Enter 不会在消息流中新增消息。

## 反例

- 如果 Shift+Enter 触发发送，消息会提前出现在消息流，输入框被清空。

## 视觉基准

不建 pixel baseline; 用输入框文本和消息流状态断言。

## 摸清依据

- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx:754-756`: ProseMirror 键盘处理入口。
- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx:1543-1569`: Shift+Enter 与普通 Enter 的分流。
