# CH1 Chat Shell

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0 (阻断)
- Tags: `@CH1 @p0 @chat @chat-shell`

## 目标

验证登录后用户可以进入会话模块，并看到最近会话入口和空态操作。

## 前置条件

- 使用 `fixtures-authed.ts`，由 fixture 预置登录态、中文语言、已完成 onboarding 和 mock IM 连接。
- 使用默认空的 mock IM seed，不需要额外 HTTP handler。

## 用户操作步骤

1. 打开应用。
2. 点击侧边栏「会话」。
3. 观察会话页的「最近」入口和空态操作。

## 预期结果

- 侧边栏「会话」入口可见并可点击。
- 会话页显示「最近」入口。
- 无会话时显示「找人聊天」操作。

## 反例

- 如果 Chat route 没有注册、会话菜单没有挂载或 mock 连接没有就绪，用户会停留在空白页或登录页，无法看到「最近」和「找人聊天」。

## 视觉基准

不建立 pixel baseline；使用可访问角色和用户可见文案断言结构。

## 摸清依据

- `apps/web/src/App/index.tsx:119-132`：注册 Chat 菜单和 `/` 路由。
- `packages/dmworkbase/src/Pages/Chat/index.tsx:1587-1660`：会话页的「关注/最近」和空态渲染。
- `apps/web/e2e-kit/fixtures-authed.ts`：登录态、MSW ready 和 mock IM 初始化。
