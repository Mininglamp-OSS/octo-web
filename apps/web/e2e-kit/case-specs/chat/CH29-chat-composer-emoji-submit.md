# CH29 Chat Composer Emoji Submit

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 优先级: P1
- Tags: `@CH29 @p1 @chat @composer @emoji`

## 目标

验证选择表情后提交，消息流出现该表情消息。

## 前置条件

- 用户已登录并打开一个可发送消息的群会话。

## 用户操作步骤

1. 打开输入框表情面板并选择表情。
2. 提交编辑器内容。

## 预期结果

- 编辑器内容被提交并清空。
- 消息流出现新的表情消息。

## 反例

- 表情仅停留在编辑器中，提交后消息流没有新消息。

## 视觉基准

不建 pixel baseline；断言编辑器和消息流的用户可见状态。

## 摸清依据

- `packages/dmworkbase/src/Components/EmojiToolbar/index.tsx`
- `packages/dmworkbase/src/Components/Conversation/index.tsx`
