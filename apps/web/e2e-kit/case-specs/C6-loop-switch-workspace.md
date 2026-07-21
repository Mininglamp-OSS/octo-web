# C6 · loop 切换 workspace

## 场景
sidebar workspace 下拉打开 → 点另一个 workspace → 上下文切换, sidebar 名字更新.

## 前置
- MSW scenario: `two-ws` (Workspace A + Workspace B)

## 步骤
1. goto `/loop?sid=e2etest`
2. 初始 sidebar 显示 Workspace A (默认 list[0])
3. 点 `.loop-sidebar__ws-btn` 打开 Semi Dropdown
4. 下拉里找 `.loop-sidebar__ws-menu-name` 文本 = "Workspace B" 的项, click

## 断言
- sidebar `.loop-sidebar__ws-name` 文本变成 "Workspace B"

## Mock
- `GET /fleet/api/v1/workspaces` → [Workspace A, Workspace B]
- 切换触发 cache 清理 + refetch issues/projects/labels (兜底 [])

## 边界 / 未覆盖
- 切换后 URL deep-link 更新
- 切换后子 tab (issue tab) 是否正确 re-mount 并 refetch (只断了 sidebar 状态, 没验证 x-workspace-slug header 变化)
- 切到同一 workspace 无操作 (no-op)
