# CH16 Chat Message Multiselect

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH16 @p1 @chat @message-context-menu`

## 目标

验证消息右键菜单进入多选模式并显示批量操作栏。

## 前置条件

- seed 一条可选择历史文本消息。

## 用户操作步骤

1. 打开消息右键菜单。
2. 点击「多选」。

## 预期结果

- 显示逐条转发、合并转发和删除操作。

## 反例

- 多选状态未切换时，批量操作栏不可见。

## 视觉基准

不建 pixel baseline; 用操作按钮 testid 断言结构。

## 摸清依据

- `packages/dmworkbase/src/module.tsx:1242-1257`
- `packages/dmworkbase/src/Components/Conversation/index.tsx:3160-3267`
