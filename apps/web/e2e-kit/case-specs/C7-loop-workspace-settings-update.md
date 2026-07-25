# C7 · loop workspace 设置更新

## 场景
`/loop` → 设置 tab → 修改 workspace 名 → 保存 → toast "已保存".

## 前置
- MSW scenario: `one-ws`
- Workspace = "Workspace A"

## 步骤
1. goto `/loop?sid=e2etest`
2. sidebar 侧栏点 "设置" (i18n `loop.nav.settings`)
3. 定位 name input (placeholder = 工作区名称), 改成 "Workspace A Renamed"
4. 点 "保存" 按钮 (i18n `loop.action.save`)

## 断言
- toast "已保存" 可见 (i18n `loop.toast.saved`)

## Mock
- `PATCH /fleet/api/v1/workspaces/:id` → echo body

## 边界 / 未覆盖
- name 为空的 client 校验 (`loop.validate.nameRequired`)
- issue_prefix / description 分开测
- 描述超长 / 特殊字符
