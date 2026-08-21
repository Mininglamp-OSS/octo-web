# ML2: Mail 邮件详情

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@ML2 @p1 @mail @mail-reader`

## 目标

验证 Inbox 中的邮件列表可以加载，并打开邮件正文详情。

## 前置条件

- Mail 开关开启，Agent mailbox、Inbox mailbox 和 identity 接口返回有效数据。
- messages 接口返回一封邮件，message detail 接口返回正文。

## 用户操作步骤

1. 进入 Mail 的 Inbox。
2. 观察首封邮件及其阅读区。

## 预期结果

- 列表显示邮件主题和发件人。
- 阅读区显示邮件正文「这是 E2E 邮件正文」。

## 反例

- 邮件列表没有展示主题，或阅读区仍停留在选择邮件空态。

## 视觉基准

不建立 pixel baseline；使用用户可见邮件字段断言。

## 摸清依据

- `packages/mail/src/features/MailRecordsFeature.tsx:113-153`：邮件选中和详情渲染。
- `packages/mail/src/ui/MailRecordsView/index.tsx:156-206`：邮件列表行。
- `packages/mail/src/features/MessageDetailFeature.tsx`：邮件正文读取。
