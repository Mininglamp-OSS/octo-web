# SP3: Space 邀请链接已过期

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: anonymous
- 优先级: P1 (回归守护)
- Tags: `@SP3 @p1 @space @invite @expired`

## 目标

验证匿名用户打开已过期的 Space 邀请链接时，页面明确提示邀请码不可用，并能返回普通入口。

## 前置条件

- 使用 `pagePlain`，仅准备中文语言和 onboarding 状态，不预置登录态。
- Per-case MSW handler: `e2e-kit/msw-handlers/sp3-space-invite-expired.ts`
  - `GET /space/invite/SP3-EXPIRED` 返回 HTTP 410 和过期错误信息。

## 用户操作步骤

1. 打开带有过期邀请码的邀请链接。
2. 观察邀请错误页面。
3. 点击「返回」。

## 预期结果

- 页面显示「邀请码无效」。
- 页面提供「返回」操作。
- 点击「返回」后，地址中不再包含 `invite` 参数。

## 反例

- 过期链接仍展示组织名称和「登录后加入」按钮。
- 页面停留在加载态、空白页，或点击返回后仍保留过期邀请码。

## 视觉基准

不建 pixel baseline；用 `getByText`、`getByRole` 和 URL 断言用户可见状态。

## 摸清依据

- `packages/dmworklogin/src/login_vm.tsx:132-151`: 登录页读取邀请参数并请求 `space/invite/{inviteCode}`。
- `apps/web/src/Layout/index.tsx:530-545`: 邀请参数进入 `InviteLanding` 路由。
- `apps/web/src/Components/InviteLanding/index.tsx:366-420`: 邀请详情失败时渲染错误文案和返回按钮。
- `apps/web/src/i18n/zh-CN.json:17`: `invite.invalidCode` 的用户可见文案为「邀请码无效」。
