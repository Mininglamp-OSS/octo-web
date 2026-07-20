# C4 · loop 创建 issue

## 场景
有 workspace 前置 → 点"新建任务" → 弹窗填 title → Enter 提交 → 成功 toast 出现.

## 前置
- MSW scenario: `one-ws`

## 步骤
1. goto `/loop?sid=e2etest`
2. 确认 sidebar 已显示 Workspace A
3. 点 `.loop-sidebar__new-btn` (i18n `loop.action.newIssue` = "新建任务")
4. Modal 出现, 找到 title input (placeholder = i18n `loop.field.titlePlaceholder` = "输入标题…")
5. 填 title = "e2e 新任务 C4", 按 Enter (Modal 支持 Enter 提交)

## 断言
- 成功 toast 出现 (i18n `loop.toast.created` = "已创建")

## Mock
- `POST /fleet/api/v1/issues` → 200 + 新 issue object

## 边界 / 未覆盖
- 附件上传 (POST /attachments)
- @mention 描述
- assignee / project / priority / status pill 完整选择
- 空 title 校验 (submit 按钮 disabled, 无 toast)
