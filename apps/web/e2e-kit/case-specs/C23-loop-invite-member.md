# C23 · loop 添加成员 (octo direct add)

## 场景
Settings/成员 → 下拉选 space 用户 → 添加成员 → 表格出现新成员.

## 覆盖
只覆盖 **octo-uid 直加** 路径 (`POST /workspaces/:id/octo-members`).
email 邀请 (`POST /workspaces/:id/members`) 目前 UI 上没入口, 不测.

## 前置
- MSW scenario: `ws-with-members` (workspace A + 2 已有 members: Admin User / Ordinary Member)
- SpaceService `getAllMembers` 返回 SPACE_HUMANS (含 Newbie User, uid=uid-newbie)
- Newbie User 不在 members 里 → 出现在候选下拉

## 步骤
1. goto `/loop?sid=e2etest`
2. sidebar 点 "设置"
3. 切到 "成员管理" tab
4. 点 `.loop-settings-invite .semi-select` 展开候选
5. 选 "Newbie User"
6. 点 "添加成员" 按钮 (i18n `loop.settings.addMember`)

## 断言
- toast "成员已添加" 可见 (i18n `loop.settings.added`)
- 表格新出现一行含 "Newbie User"

## Mock
- `POST /fleet/api/v1/workspaces/:id/octo-members` → 返新成员
- `GET /api/v1/space/:spaceId/members` → SPACE_HUMANS
- `GET /fleet/api/v1/workspaces/:id/members` → members + 新加的
- `GET /fleet/api/v1/workspaces/:id/invitations` → []

## 边界 / 未覆盖
- email 邀请路径 (UI 无入口)
- role 修改成员级别 (默认 member)
- 添加已存在成员的错误提示
