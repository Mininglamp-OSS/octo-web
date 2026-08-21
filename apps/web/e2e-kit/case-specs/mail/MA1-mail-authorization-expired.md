# MA1: Mail 授权链接缺少 Space

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@MA1 @p1 @mail @mail-authorization`

## 目标

验证缺少 Space 信息的 Agent Mail 授权链接会明确提示用户重新发起接入。

## 前置条件

- 访问 `/mail/authorize?code=E2E-CODE`，不提供 Space 信息。

## 用户操作步骤

1. 打开缺少 Space 的授权链接。
2. 观察授权状态。

## 预期结果

- 页面显示「授权 Agent 使用邮箱」。
- 页面显示「授权链接缺少 Space 信息，请返回邮箱管理页重新发起接入。」。

## 反例

- 缺少 Space 时仍显示确认授权按钮，或页面停留在 loading。

## 视觉基准

不建立 pixel baseline；使用用户可见文案断言。

## 摸清依据

- `packages/mail/src/module.tsx:65-75`：授权路由。
- `packages/mail/src/features/MailAuthorizationPage.tsx:148-158`：缺少 Space 的本地校验。
- `packages/mail/src/i18n/zh-CN.json:281-309`：授权页面文案。
