# X2 Summary 分享冷启动链接边界

## Metadata

- Case 类型: boundary flow
- 目标模式: standalone deep link
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@X2 @p1 @cross-module @summary @deep-link @cold-start`

## 目标

验证直接打开 Summary 分享链接时可以查看正文，但不会显示只适用于 Chat 来源的返回聊天入口。

## 前置条件

- fixture: `fixtures-authed` 冷启动页面。
- Per-case handler: `e2e-kit/msw-handlers/x2-summary-share-cold-link-boundary.ts`，复用已验证的分享详情响应。

## 用户操作步骤

1. 直接打开复用的分享链接 `/s/share/e2e-share-026`。
2. 查看分享正文和页面操作入口。

## 预期结果

- 显示 `S26 分享总结` 及正文。
- 不显示「返回聊天」入口，因为当前入口不是从 Chat 上下文打开。

## 反例

- 冷启动分享页出现返回聊天入口，可能将用户带回错误会话，case 应失败。

## 视觉基准

不建 pixel baseline；使用标题、正文和返回入口断言。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryShareDetailPage.tsx:71-88`: 仅有 `originChannel` 时渲染返回聊天入口。
- `apps/web/e2e-kit/case-specs/summary/S26-summary-standalone-links.md`: 已验证的独立分享链接 fixture。
