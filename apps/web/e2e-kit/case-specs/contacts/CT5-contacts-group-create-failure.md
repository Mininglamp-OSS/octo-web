# CT5 通讯录发起群聊失败反馈

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CT5 @p1 @contacts @contacts-group`

## 目标

验证从通讯录/会话侧选择成员发起群聊时，创建接口失败会保留填写内容和弹窗，用户可以重试或取消。

## 前置条件

- 使用 `fixtures-authed` 和默认 mock IM runtime。
- Per-case handler `e2e-kit/msw-handlers/ct5-contacts-group-create-failure.ts`：提供一个可选成员，并让 `/group/create` 返回失败。
- 从会话侧打开“发起群聊”对话框。

## 用户操作步骤

1. 打开会话页，点击添加入口并选择“发起群聊”。
2. 填写群聊名称并选择“E2E 建群成员”。
3. 点击“确定”。
4. 观察创建结果。

## 预期结果

- 页面显示“创建群聊失败”。
- 发起群聊弹窗仍保持打开，已填写的群聊名称和已选成员不丢失。
- 不进入新建群聊会话。

## 反例

- 失败响应不应被当作成功，不应关闭弹窗或出现新群聊标题。
- 失败后不应清空已选成员。

## 视觉基准

不建 pixel baseline；使用弹窗、文本和表单可见状态断言结构。

## 摸清依据

- `packages/dmworkcontacts/src/Organizational/GroupNew/index.tsx:39-117`：创建群聊模式、错误通知和提交入口。
- `packages/dmworkcontacts/src/bridge/groupCreate/useGroupCreate.ts:126-194`：名称/成员校验、提交失败后保留表单状态。
- `packages/dmworkcontacts/src/bridge/groupCreate/groupCreateRuntime.ts:385-418`：创建群聊调用和失败传播。
- `packages/dmworkbase/src/Service/ChannelSettingService.ts:77-98`：`group/create` 服务入口。
- `apps/web/e2e-kit/tests/chat/chat-layout-coverage.spec.ts:62-72`：现有发起群聊成功态用户路径。
