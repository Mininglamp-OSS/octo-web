# S29 Summary 详情只读权限

## Metadata

- Case 类型: permission flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S29 @p1 @summary @detail @summary-permission @readonly`

## 目标

验证无团队编辑权限的成员可以查看已完成总结，但不能看到团队编辑入口。

## 前置条件

- fixture: `fixtures-authed`，使用 Summary mock API。
- Per-case handler: `e2e-kit/msw-handlers/s29-summary-detail-readonly-permission.ts`。
  - 返回已完成总结正文。
  - 详情权限 `can_edit`、`can_edit_team` 均为 false。

## 用户操作步骤

1. 从主导航打开「智能总结」。
2. 打开 `S29 只读总结` 详情。
3. 查看总结正文。

## 预期结果

- 详情标题和正文可见。
- 团队编辑入口不显示，当前用户不能进入编辑器。

## 反例

- 无编辑权限用户显示编辑入口，说明权限边界未生效，case 应失败。
- 无权限用户无法查看正文，不符合只读访问语义，case 应失败。

## 视觉基准

不建 pixel baseline；使用标题、正文和编辑入口数量断言。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2837-2864`: 团队编辑入口由 `permissions.can_edit` 控制。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3174-3180`: 多人团队编辑入口由 `permissions.can_edit_team` 控制。
