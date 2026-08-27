# SP5: Space 邀请加入需审批

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@SP5 @p1 @space @invite @approval`

## 目标

验证审批制 Space 的邀请加入不会被误展示为已加入，而是明确展示申请已提交的结果。

## 前置条件

- 使用 `fixtures-authed.ts` 提供登录态、中文语言和 mock IM runtime。
- Per-case MSW handler: `e2e-kit/msw-handlers/sp5-space-invite-approval.ts`
  - `GET /space/invite/SP5-APPROVAL` 返回可加入的 Space 邀请详情。
  - `POST /space/join` 返回业务状态 `NEED_APPROVAL`。

## 用户操作步骤

1. 打开审批制 Space 的邀请链接。
2. 点击「加入组织」。
3. 观察加入结果。

## 预期结果

- 页面显示 Space 名称「SP5 审批组织」和加入入口。
- 加入后显示「申请已提交」。
- 页面显示「你的加入申请已提交，请等待管理员审批通过后即可加入」。
- 不显示已加入成功的主界面或「已加入」提示。

## 反例

- `NEED_APPROVAL` 被当作成功加入，直接切换到 Space 主界面。
- 申请提交后没有结果反馈，或错误显示为加入失败。

## 视觉基准

不建 pixel baseline；用用户可见文本断言审批结果。

## 摸清依据

- `apps/web/src/Components/InviteLanding/index.tsx:242-260`: 邀请加入返回 `NEED_APPROVAL` / `PENDING` 时转交全局审批结果处理。
- `apps/web/src/Layout/index.tsx:148-152,403-410`: Layout 接收审批状态并渲染 `JoinApprovalResult`。
- `apps/web/src/Components/JoinApprovalResult/index.tsx:18-45`: 审批结果标题、说明和确认按钮渲染。
- `apps/web/src/i18n/zh-CN.json:35-39`: 审批结果中文文案。
