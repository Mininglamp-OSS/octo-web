# CH3 Chat Send Text

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH3 @p1 @chat @conversation @composer`

## 目标

验证用户在已打开的会话中输入并发送一条文本消息，发送后的消息会出现在当前消息流中。

## 前置条件

- 使用 `fixtures-authed.ts`。
- 使用 `installMockImRuntime` 注入一个可打开的群会话和一条历史文本消息。
- 使用 SDK mock 的本地发送路径，不依赖真实后端。

## 用户操作步骤

1. 打开应用并进入「会话」。
2. 点击「E2E Chat 群」。
3. 在消息输入框输入「E2E 文本消息」。
4. 按 Enter 发送。

## 预期结果

- 消息输入框可见并接受文本输入。
- 发送后消息流显示「E2E 文本消息」。
- 输入框中的待发送文本被清空或不再作为草稿显示。

## 反例

- 如果编辑器没有接入发送流程，按 Enter 后「E2E 文本消息」不会进入当前消息流；如果发送后编辑器仍保留原文本，则表示消费草稿或发送收尾逻辑异常。

## 视觉基准

不建立 pixel baseline；只断言消息流和输入状态。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/index.tsx:3270-3345`：会话底部挂载 ChatComposer。
- `packages/dmworkbase/src/Components/Conversation/vm.ts:2450-2580`：文本消息发送和本地发送队列。
- `apps/web/e2e-kit/_kit/mock-im-runtime/fake-provider.ts:94-107`：mock 文本消息构造。
