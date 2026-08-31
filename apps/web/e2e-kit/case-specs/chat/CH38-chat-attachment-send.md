# CH38 — 附件上传并发送

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CH38 @p1 @chat @composer @attachment`

## 目标

验证选择附件并提交后，消息流保留文件名。

## 前置条件

- 上传 credentials 和直传 endpoint 返回成功。

## 用户操作步骤

1. 选择文本附件。
2. 提交 composer。

## 预期结果

- 文件名出现在消息流中。

## 反例

- 上传凭证缺失时应保留可重试状态，不显示成功发送的文件消息。

## 视觉基准

不建 pixel baseline；用 `getByText` 断言文件消息。

## 摸清依据

- `packages/dmworkbase/src/Components/Conversation/index.tsx`
- `packages/dmworkbase/src/Service/UploadCredentials.ts`
