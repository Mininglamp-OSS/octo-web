# SP2 邀请链接登录后自动加入

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: anonymous → authed
- 优先级: P1 (回归守护)
- Tags: `@SP2 @p1 @space @invite @login`

## 目标

验证匿名用户打开邀请链接后进入登录引导，登录完成后邀请码被保留并自动加入目标 Space，最终回到主界面。

## 前置条件

- fixture: `pagePlain`，通过 init script 或页面交互准备登录态切换。
- Per-case MSW handler: `e2e-kit/msw-handlers/sp2-space-invite-login.ts`
  - 邀请详情返回 `invite_code`、`space_id`、`space_name`。
  - 登录后的自动加入校验请求中的 `invite_code` 并返回 `space_id`。

## 用户操作步骤

1. 打开带 `invite` 参数的邀请链接。
2. 点击登录并完成本地 mock 登录流程。
3. 等待应用处理待加入的邀请码。

## 预期结果

- 匿名邀请页显示登录引导。
- 登录后回到应用主界面，不丢失邀请目标。
- 主界面出现加入成功提示或目标 Space 名称。

## 反例

- 登录后不应回到空白首页并丢失邀请码。
- 不应把邀请码拼接到外部地址或暴露在页面正文中。

## 视觉基准

不建 pixel baseline；使用可见文本与 URL 断言结构。

## 摸清依据

- `apps/web/src/Layout/index.tsx:243-303`: 登录回调消费 `pendingInviteCode` 并自动加入。
- `apps/web/src/Layout/index.tsx:530-545`: 邀请链接路由进入 `InviteLanding`。
- `apps/web/src/Components/InviteLanding/index.tsx:221-285`: 匿名邀请加入与登录重定向逻辑。
