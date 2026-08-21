# MA2: Mail 授权参数无效

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@MA2 @p1 @mail @mail-authorization`

## 目标

验证缺少授权 code 的链接会显示可理解的无效授权提示。

## 前置条件

- 访问 `/mail/authorize?space_id=e2e-space-001`，不请求后端授权详情。

## 用户操作步骤

1. 打开缺少授权 code 的链接。
2. 观察授权状态。

## 预期结果

- 页面显示「授权 Agent 使用邮箱」。
- 页面显示「授权码无效，请让 Bot 重新发起接入」。

## 反例

- 缺少 code 时仍发起无效的授权确认流程，或页面停留在 loading。

## 视觉基准

不建立 pixel baseline；使用用户可见文案断言。

## 摸清依据

- `packages/mail/src/features/MailAuthorizationPage.tsx:148-158`：缺少 code 的本地校验。
- `packages/mail/src/i18n/zh-CN.json:281-292`：授权异常文案。
