# CH17 Chat Composer Emoji

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH17 @p1 @chat @composer @emoji`

## 目标

验证从输入框表情面板选择表情后，表情进入编辑器。

## 前置条件

- seed 一个可打开群会话。

## 用户操作步骤

1. 打开输入框表情面板。
2. 选择一个表情。

## 预期结果

- 编辑器不为空并保留所选表情。

## 反例

- 面板点击没有写入编辑器时，编辑器仍为空。

## 视觉基准

不建 pixel baseline; 用面板和编辑器内容断言。

## 摸清依据

- `packages/dmworkbase/src/Components/EmojiToolbar/index.tsx:550-565`
- `packages/dmworkbase/src/Components/Conversation/index.tsx:3359-3378`
