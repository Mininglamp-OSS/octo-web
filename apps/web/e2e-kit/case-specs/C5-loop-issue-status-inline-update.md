# C5 · loop issue status 内联切换

## 场景
详情页面板 → 点 status pill (Dropdown) → 选新状态 → UI 立即反映.

## 前置
- MSW scenario: `one-issue` (Workspace A + Issue "First issue" status=todo)

## 步骤
1. goto `/loop?sid=e2etest`
2. 确认 sidebar 已加载
3. 点 issue 卡片文本 "First issue" 打开详情
4. 定位属性栏第一条 pill (`.loop-idp__prop-edit`), 确认当前显示 "待办"
5. 点 pill → Dropdown 出现
6. 点 menuitem "进行中"

## 断言
- pill 文本变成 "进行中" (i18n `loop.status.in_progress`)
- 无错误 toast

## Mock
- `GET /fleet/api/v1/issues/:id` → issue 详情
- `PUT /fleet/api/v1/issues/:id` → echo 请求 body (含新 status)
- `GET /fleet/api/v1/issues/:id/{comments,children,timeline,subscribers}` → []
- `GET /fleet/api/v1/runs` → []

## 边界 / 未覆盖
- 分派给 offline agent 触发 RunConfirmModal
- 权限拒绝 (403 状态回滚)
- 其他属性 (priority / assignee / project) 内联编辑
