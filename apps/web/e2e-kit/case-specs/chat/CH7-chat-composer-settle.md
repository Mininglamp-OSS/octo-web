# CH7 Chat Composer Settle

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH7 @p1 @chat @composer`

## 目标

验证 transactional composer 发送文本后立即消费草稿，并在消息流中留下已发送消息。

## 前置条件

- 使用 `fixtures-authed.ts`。
- 使用 `installMockImRuntime` 注入一个可打开的群会话。
- 使用本地 mock IM 发送路径，不依赖真实后端。

## 用户操作步骤

1. 打开应用并进入「会话」的「最近」列表。
2. 打开「E2E Chat 群」。
3. 在消息输入框输入「E2E transactional message」。
4. 按 Enter 发送。

## 预期结果

- 消息流显示「E2E transactional message」。
- 发送完成后编辑器不再显示待发送原文。

## 反例

- 如果消息进入消息流但编辑器仍保留原文，说明 compose consume 或 settle 阶段回退。
- 如果编辑器被清空但消息流没有消息，说明发送收尾丢失了用户输入。

## 视觉基准

不建 pixel baseline; 用消息流和编辑器可观察状态断言。

## 摸清依据

- `packages/dmworkbase/src/features/chat-composer/ui/ChatComposer.tsx:1626-1657`: 发送中内容与编辑器消费语义。
- `packages/dmworkbase/src/Components/Conversation/index.tsx:3270-3345`: 会话页挂载 composer。
- `packages/dmworkbase/src/features/chat-composer/application/composeConsume.ts`: compose consume 流程。
