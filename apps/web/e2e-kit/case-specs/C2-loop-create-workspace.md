# C2 · loop 创建 workspace

## 场景
空态点"创建工作区" → 弹窗填名 → 提交 → workspace 出现在 sidebar.

## 前置
- MSW scenario: `create-ws` (POST 前 GET []; POST 后 GET [新 workspace])

## 步骤
1. goto `/loop?sid=e2etest`
2. 看到"还没有工作区"引导 + "创建工作区" 按钮
3. 点按钮 → LoopCreateWorkspaceModal 弹出
4. 填 name = "E2E Workspace C2"
5. 点 Modal 提交按钮 (Semi Modal `aria-label="confirm"`, 内文 = i18n `loop.action.create` = "创建")

## 断言
- sidebar `.loop-sidebar__ws-name` 文本 = "E2E Workspace C2"
- "还没有工作区" 文案消失

## Mock
- `POST /fleet/api/v1/workspaces` → 200 + 新 workspace object
- `GET /fleet/api/v1/workspaces` → 第一次 [], 第二次 (POST 之后) [新 workspace]

## 边界 / 未覆盖
- slug 冲突自动 re-roll (backend 409 → autoSlug retry 3 次)
- 手动填 slug 冲突 toast "该 slug 已被占用"
- 网络错误 toast
