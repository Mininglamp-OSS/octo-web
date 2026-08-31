# CH43: Chat 附件上传失败保留待发送附件

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH43 @p1 @chat @composer @attachment @retry`

## 目标

验证附件上传失败时，附件仍保留在 composer 中供用户重试，不被误显示为已发送成功。

## 前置条件

- 使用 mock IM runtime seed 一个群会话。
- Per-case handler `e2e-kit/msw-handlers/ch43-chat-attachment-failure.ts`：上传凭证请求返回 500。

## 用户操作步骤

1. 打开群会话。
2. 选择文本附件并输入一条消息后提交。
3. 观察 composer 中的附件。

## 预期结果

- 文本消息可以正常显示在消息流中。
- 上传失败的附件仍显示在 composer 中，文件名没有丢失。
- 消息流中不显示该附件的成功发送记录。

## 反例

- 上传失败后附件从 composer 消失，或消息流显示附件已经发送成功。

## 视觉基准

不建 pixel baseline；用文件名和消息流状态断言。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/index.tsx:1179-1200`: 消息未确认时保留发送状态。
- `packages/dmworkbase/src/features/chat-composer/adapters/conversation/createConversationChatSendHandler.ts:150-170`: 文件上传失败返回失败结果。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:948-949`: 文件重试文案契约。
