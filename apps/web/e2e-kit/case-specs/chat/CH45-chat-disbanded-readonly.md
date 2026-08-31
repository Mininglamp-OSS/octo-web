# CH45: 已解散群聊只读

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH45 @p1 @chat @permission @readonly`

## 目标

验证群聊已解散时保留历史会话，但发送区域进入只读提示，用户不能继续发送消息。

## 前置条件

- 使用 mock IM runtime seed 一个群会话，其 channel `orgData.status` 为 `2`（已解散）。

## 用户操作步骤

1. 打开已解散的群会话。
2. 观察会话底部发送区域。

## 预期结果

- 页面仍显示群名称和会话页面。
- 底部显示「群聊已解散，无法发送消息」。
- 不显示可编辑的消息输入框。

## 反例

- 已解散群仍显示可发送输入框，或用户可以继续发送消息。

## 视觉基准

不建 pixel baseline；用用户可见只读提示断言。

## 摸清依据

- `packages/dmworkbase/src/Utils/groupDisband.ts:16-25`: 群状态 `2` 表示已解散。
- `packages/dmworkbase/src/Components/Conversation/index.tsx:3054-3056,3303-3310`: 已解散会话隐藏 composer，渲染只读提示。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:264`: 已解散群只读文案。
- `apps/web/e2e-kit/_kit/mock-im-runtime/fake-provider.ts:51-60`: seed 的 `group.extra` 映射为频道 `orgData`。
