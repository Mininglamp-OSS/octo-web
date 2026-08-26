# CH9 Chat Message Context Menu

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed + per-case MSW
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH9 @p1 @chat @message-context-menu`

## 目标

验证用户可以在历史文本消息上打开右键菜单，并看到当前版本支持的复制、回复、转发和多选入口。

## 前置条件

- 使用 `fixtures-authed.ts` 和本地 mock IM。
- seed 一个群会话及一条历史文本消息。
- per-case handler 返回 `POST /message/channel/sync` 的真实消息 payload shape。

## 用户操作步骤

1. 进入「会话」的「最近」列表并打开「E2E Chat 消息群」。
2. 在「E2E 历史文本消息」上打开右键菜单。
3. 观察消息操作菜单。

## 预期结果

- 菜单显示「复制」「回复」「转发」「多选」。

## 反例

- 如果历史消息同步缺少 payload，正文不会渲染，无法打开消息菜单。
- 如果右键事件未绑定，消息操作菜单不会出现。

## 视觉基准

不建 pixel baseline; 用可见菜单文案和 testid 断言结构。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/index.tsx:1621-1646`: 消息右键菜单打开入口。
- `packages/dmworkbase/src/module.tsx:1065-1258`: 复制、转发、回复和多选菜单注册。
- `packages/dmworkdatasource/src/conversation.ts:42-55`: 历史消息同步 endpoint 与响应转换入口。
