# CH13 Chat Message Reaction

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH13 @p1 @chat @reaction`

## 目标

验证消息右键菜单可以打开贴表情选择器。

## 前置条件

- chat baseline 开启 message reaction read/write。
- seed 一条历史文本消息。

## 用户操作步骤

1. 打开历史消息右键菜单。
2. 点击「贴表情」。

## 预期结果

- 显示表情选择器并提供可选表情。

## 反例

- reaction 能力关闭或右键入口缺失时，选择器不应出现。

## 视觉基准

不建 pixel baseline; 用 dialog 和表情单元断言结构。

## 摸清依据

- `packages/dmworkbase/src/module.tsx:1162-1200`
- `packages/dmworkbase/src/ui/message/MessageReactionPicker/ReactionPickerOverlay.tsx:93-143`
