# CH6 Chat Clear Unread

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH6 @p1 @chat @unread`

## 目标

验证用户从最近会话菜单清除未读后，会话行和最近页角标同步回到已读状态。

## 前置条件

- 使用 `fixtures-authed.ts`。
- 使用 `installMockImRuntime` 注入一个 unread 为 2 的群会话。
- Per-case handler 返回清除未读成功响应。

## 用户操作步骤

1. 打开应用并进入「会话」的「最近」列表。
2. 在「E2E Chat 群」上打开上下文菜单。
3. 点击「清除未读」。
4. 观察会话行和最近页角标。

## 预期结果

- 清除未读菜单项可见并可点击。
- 会话行不再显示未读数量。
- 最近页不再显示该会话产生的未读角标。

## 反例

- 如果清除后会话行仍显示未读数量，说明本地 conversation snapshot 没有同步。
- 如果最近页角标仍保留，说明 sidebar unread 通知没有同步到 tab。

## 视觉基准

不建 pixel baseline; 用用户可见未读状态断言。

## 摸清依据

- `packages/dmworkbase/src/Components/ConversationList/index.tsx:1381-1425`: 清除未读菜单及成功后的本地通知。
- `packages/dmworkbase/src/Pages/Chat/index.tsx:128-329`: 最近/关注 tab 角标计算。
- `apps/web/e2e-kit/_kit/mock-im-runtime/seed-types.ts:70-76`: unread conversation seed shape。
