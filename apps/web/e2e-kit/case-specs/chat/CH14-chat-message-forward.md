# CH14 Chat Message Forward

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH14 @p1 @chat @forward`

## 目标

验证消息右键菜单可以打开转发面板。

## 前置条件

- seed 一条可转发历史文本消息。

## 用户操作步骤

1. 打开消息右键菜单。
2. 点击「转发」。

## 预期结果

- 显示转发面板。

## 反例

- 转发入口缺失或面板未挂载时，转发标题不可见。

## 视觉基准

不建 pixel baseline; 用转发 modal 标题断言结构。

## 摸清依据

- `packages/dmworkbase/src/module.tsx:1211-1228`
- `packages/dmworkbase/src/Components/ForwardModal`
