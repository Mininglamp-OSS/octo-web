# C3 · loop 有 workspace 默认视图

## 场景
`GET /workspaces → [ws]` 时, `/loop` 挂载走到默认 tab (issue), 展示 workspace 名 + issue 空态.

## 前置
- MSW scenario: `one-ws` (workspaces=[Workspace A], issues={issues:[], total:0})

## 步骤
1. goto `/loop?sid=e2etest`

## 断言
- sidebar `.loop-sidebar__ws-name` = "Workspace A"
- 主区域文本 "还没有任务" 可见 (i18n `loop.empty.issueTitle`)
- 主区域文本 "创建第一个任务，开始跟踪你的工作。" 可见 (i18n `loop.empty.issueDesc`)
- "还没有工作区" 引导不再出现 (对偶 C1)

## Mock
- `GET /fleet/api/v1/workspaces` → [Workspace A]
- `GET /fleet/api/v1/issues` → { issues: [], total: 0 }

## 边界 / 未覆盖
- 有 issue 但被筛选清空的空态
- 权限 / workspace 不存在跳转
