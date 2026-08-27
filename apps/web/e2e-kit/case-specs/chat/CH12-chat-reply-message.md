# CH12 Chat Reply Message

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed + per-case MSW
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH12 @p1 @chat @message-context-menu`

## 目标

验证用户从历史文本消息的右键菜单选择「回复」后，输入框上方进入回复态并展示目标消息上下文。

## 前置条件

- 使用 `fixtures-authed.ts` 和本地 mock IM。
- seed 一个群会话及一条历史文本消息。
- per-case handler 返回 `POST /message/channel/sync` 的真实消息 payload shape。

## 用户操作步骤

1. 打开「E2E Chat 消息群」。
2. 在「E2E 历史文本消息」上打开右键菜单。
3. 点击「回复」。
4. 观察输入框上方的回复视图。

## 预期结果

- 页面显示回复态。
- 回复视图显示发送者「E2E Sender」和目标文本「E2E 历史文本消息」。

## 反例

- 如果回复菜单未调用回复状态，输入框上方不会出现回复视图。
- 如果消息发送者或正文没有正确传入回复视图，目标上下文会缺失。

## 视觉基准

不建 pixel baseline; 用回复视图 class 和可见文本断言结构。

## 摸清依据

- `packages/dmworkbase/src/module.tsx:1228-1239`: 消息右键「回复」菜单注册。
- `packages/dmworkbase/src/Components/Conversation/index.tsx:1477-1491`: 回复状态设置与输入框聚焦。
- `packages/dmworkbase/src/Components/Conversation/index.tsx:3359-3367`: 回复视图挂载条件。
- `packages/dmworkbase/src/Components/Conversation/index.tsx:3714-3743`: 回复视图展示发送者与目标文本。
