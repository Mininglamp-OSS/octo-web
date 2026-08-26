# CH8 Chat Sidebar Badges

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH8 @p1 @chat @sidebar`

## 目标

验证最近和关注两个会话侧栏在完成初始加载后显示稳定的列表和未读角标，不因关注数据为空而误隐藏最近角标。

## 前置条件

- 使用 `fixtures-authed.ts`。
- mock IM seed 注入一个 unread 为 1 的最近群会话。
- Per-case `/sidebar/sync` handler 返回一个空关注列表和稳定版本号。

## 用户操作步骤

1. 打开应用并进入「会话」。
2. 等待「最近」列表完成加载。
3. 观察「最近」和「关注」tab 的角标及会话列表。

## 预期结果

- 初始 loading 结束后显示最近会话列表，不停留在加载态。
- 最近 tab 保留未读角标。
- 关注 tab 没有虚假的未读角标，切换到关注页显示空态或空列表。

## 反例

- 如果关注同步为空导致最近角标被一起清零，说明 badge readiness 逻辑回退。
- 如果初始快照未完成就显示错误角标，说明 loading 和 badge 状态没有隔离。

## 视觉基准

不建 pixel baseline; 用 tab、角标和列表 UI 断言。

## 摸清依据

- `packages/dmworkbase/src/Pages/Chat/index.tsx:128-225`: 最近/关注角标数据源和免打扰过滤。
- `packages/dmworkbase/src/Pages/Chat/index.tsx:1682-1697`: tab 与 loading 分支。
- `packages/dmworkbase/src/Hooks/useFollowSidebar.ts:81-125`: 关注侧栏同步和 loading/error 状态。
- `apps/web/e2e-kit/msw-handlers/chat-baseline.ts:119-122`: 现有 sidebar baseline handler。
