# C24 · loop 移除成员

## 场景
Settings/成员 → 删除普通成员 → 确认弹窗 → 行消失 + toast.

## 前置
- MSW scenario: `member-remove` (workspace A + 2 已有 members)

## 步骤
1. goto `/loop?sid=e2etest`
2. sidebar 点 "设置"
3. 切到 "成员管理" tab
4. 定位包含 "Ordinary Member" 的 row
5. 点该 row 的 danger 按钮 (Trash2 icon, `button.semi-button-danger`)
6. 弹出确认 Modal (i18n `loop.settings.removeMember` = "移除成员")
7. 点 Modal 里的 `aria-label="confirm"` (i18n `loop.action.delete` = "删除")

## 断言
- toast "已删除" 可见 (i18n `loop.toast.deleted`)
- Ordinary Member 的 row 消失

## Mock
- `DELETE /fleet/api/v1/workspaces/:id/members/:memberId` → 204
- `GET /fleet/api/v1/workspaces/:id/members` → 排除已 remove 的

## 边界 / 未覆盖
- 移除 owner (UI 禁用按钮)
- 移除最后一个 admin (后端会拒)
- 移除自己
- 移除后 directory cache 失效 (kit 只断 UI)
