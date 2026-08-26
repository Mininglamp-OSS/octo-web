# MM2: 新邮件编辑器

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@MM2 @p1 @mail @mail-compose`

## 目标

验证用户可以从 Mail Inbox 打开新邮件编辑器，并看到收件人、主题和正文输入项。

## 前置条件

- Mail 开关开启。
- Agent mailbox、Inbox mailbox 和 identity 接口返回有效数据。
- Inbox 邮件列表为空。

## 用户操作步骤

1. 进入 Mail。
2. 点击「写邮件」。

## 预期结果

- 页面显示「新邮件」编辑器。
- 收件人、主题和正文输入项可见。

## 反例

- 写邮件入口禁用、编辑器未打开，或缺少必要字段。

## 视觉基准

不建立 pixel baseline；使用 dialog、label 和 placeholder 断言。

## 摸清依据

- `packages/mail/src/features/MailSidebar.tsx:111-137`：写邮件入口切换 composer。
- `packages/mail/src/features/MailRecordsFeature.tsx:183-203`：composer dialog 挂载。
- `packages/mail/src/i18n/zh-CN.json:91-104`：编辑器字段文案。
