# CH5 Chat Context Menu

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH5 @p1 @chat @context-menu`

## 目标

验证用户可以在最近会话上打开上下文菜单，并看到当前版本支持的置顶、清除未读和免打扰操作。

## 前置条件

- 使用 `fixtures-authed.ts`，本地 mock IM 已连接。
- 使用 `installMockImRuntime` 注入一个有未读消息的群会话。
- 不依赖真实后端；菜单操作只观察 UI，不断言请求。

## 用户操作步骤

1. 打开应用并进入「会话」的「最近」列表。
2. 在「E2E Chat 群」上打开上下文菜单。
3. 观察菜单项及分隔结构。

## 预期结果

- 菜单显示「置顶会话」「清除未读」「设为免打扰」。
- 菜单显示独立分隔线。
- 菜单没有「标记为未读」「清空聊天记录」「关闭聊天窗口」等已移除入口。

## 反例

- 如果右键事件没有绑定，菜单不会出现。
- 如果菜单矩阵回退，用户会看到已移除的清空、关闭或标记未读入口。

## 视觉基准

不建 pixel baseline; 用用户可见菜单文案断言结构。

## 摸清依据

- `packages/dmworkbase/src/Components/ConversationList/index.tsx:1366-1475`: 最近会话上下文菜单的顺序、条件和分隔线。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:36-49`: 当前菜单文案及错误文案。
- `apps/web/e2e-kit/_kit/mock-im-runtime/seed-types.ts:70-76`: conversation seed shape。
