# CH19 Chat Thread Create

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH19 @p1 @chat @thread`

## 目标

验证群消息右键菜单可以打开创建子区弹窗。

## 前置条件

- chat baseline 开启 thread。
- seed 一条群历史文本消息。

## 用户操作步骤

1. 打开群消息右键菜单。
2. 点击「创建子区」。

## 预期结果

- 显示创建子区弹窗。

## 反例

- thread 开关关闭或当前频道非群聊时，不显示创建子区入口。

## 视觉基准

不建 pixel baseline; 用 modal 标题断言。

## 摸清依据

- `packages/dmworkbase/src/module.tsx:1341-1453`
- `packages/dmworkbase/src/Components/Conversation/index.tsx:3160-3267`
