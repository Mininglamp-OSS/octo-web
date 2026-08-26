# CH2 Chat Open Conversation

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0 (阻断)
- Tags: `@CH2 @p0 @chat @conversation`

## 目标

验证用户可以从最近会话列表打开一个会话，并看到该会话已有的消息内容。

## 前置条件

- 使用 `fixtures-authed.ts`。
- 使用 `installMockImRuntime` 注入一个群会话、群名称和一条历史文本消息。
- 不依赖真实后端和真实 IM 连接。

## 用户操作步骤

1. 打开应用并进入「会话」。
2. 在「最近」列表中点击「E2E Chat 群」。
3. 观察会话内容区。

## 预期结果

- 最近列表显示「E2E Chat 群」。
- 点击后会话内容区显示历史消息「欢迎来到 E2E Chat」。
- 页面没有跳转到登录页或显示会话加载失败。

## 反例

- 如果会话 seed 没有进入最近列表，用户看不到「E2E Chat 群」；如果消息同步或会话挂载断裂，点击后不会显示「欢迎来到 E2E Chat」。

## 视觉基准

不建立 pixel baseline；使用用户可见文本断言。

## 摸清依据

- `packages/dmworkbase/src/Pages/Chat/index.tsx:1587-1715`：最近列表和会话点击入口。
- `packages/dmworkbase/src/Components/ConversationList/index.tsx:760-920`：会话行名称和点击行为。
- `apps/web/e2e-kit/_kit/mock-im-runtime/fake-provider.ts:180-216`：按 channel 和 messageSeq 返回 mock 历史消息。
