# CH40 — 撤回消息完成态

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CH40 @p1 @chat @message-lifecycle`

## 目标

验证撤回成功后的 IM 命令回推能把原消息收敛为撤回提示。

## 前置条件

- 当前用户拥有消息撤回权限。
- 撤回接口成功，并回推 `messageRevoke` 命令。

## 用户操作步骤

1. 右键自己的历史消息。
2. 点击「撤回」。

## 预期结果

- 原消息正文不再显示。
- 页面显示「你撤回了一条消息」。

## 反例

- 只返回 HTTP 成功但没有命令回推时，消息不应被测试伪造为已撤回。

## 视觉基准

不建 pixel baseline；用消息正文和撤回提示断言。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/vm.ts`
- `packages/dmworkbase/src/Messages/Revoke/index.tsx`
- `packages/dmworkdatasource/src/conversation.ts`
