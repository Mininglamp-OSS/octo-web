# ML3: Mail 邮件搜索

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@ML3 @p1 @mail @mail-search`

## 目标

验证用户可以在 Inbox 输入关键词，看到后端返回的匹配邮件列表。

## 前置条件

- Mail 开关开启，Agent mailbox、Inbox mailbox 和 identity 接口返回有效数据。
- messages 接口根据 `search` 返回匹配的 E2E 邮件。

## 用户操作步骤

1. 进入 Mail 的 Inbox。
2. 在「搜索邮件」输入 `E2E 搜索`。

## 预期结果

- 搜索框保留输入内容。
- 列表显示匹配主题「E2E 搜索结果」。

## 反例

- 输入关键词后请求结果未更新，或列表仍展示不匹配的邮件。

## 视觉基准

不建立 pixel baseline；使用 placeholder 和用户可见邮件字段断言。

## 摸清依据

- `packages/mail/src/ui/MailRecordsView/index.tsx:102-115`：邮件搜索输入。
- `packages/mail/src/bridge/useMailWorkspace.ts:368-408`：消息列表刷新和搜索状态。
- `packages/mail/src/Service/MailService.ts:406-418`：messages API 契约。
