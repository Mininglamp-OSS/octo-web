# CH15 Chat Message Revoke

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH15 @p1 @chat @message-context-menu`

## 目标

验证当前用户有权限的消息显示撤回入口。

## 前置条件

- 当前用户作为群主 seed 历史消息权限。

## 用户操作步骤

1. 打开自己的历史消息右键菜单。
2. 观察消息操作菜单。

## 预期结果

- 菜单显示「撤回」。

## 反例

- 权限判断错误时，自己的消息会错误隐藏撤回入口。

## 视觉基准

不建 pixel baseline; 用菜单文案断言。

## 摸清依据

- `packages/dmworkbase/src/module.tsx:1259-1338`
- `packages/dmworkbase/src/Service/revokePermission.ts:40-69`
