# MM1: Agent mailbox 管理

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@MM1 @p1 @mail @mail-management`

## 目标

验证用户可以从 Mail 进入 Agent mailbox 管理页，并看到已有邮箱与新建邮箱入口。

## 前置条件

- Mail 开关开启。
- Agent mailbox registration 接口返回一个有效邮箱和创建上限。

## 用户操作步骤

1. 进入 Mail。
2. 点击「管理 Agent 邮箱」。

## 预期结果

- 页面标题显示「Agent 邮箱管理」。
- 已有邮箱地址和「新建 Agent 邮箱」区域可见。

## 反例

- 管理入口不可用、邮箱列表持续 loading，或创建区域未渲染。

## 视觉基准

不建立 pixel baseline；使用用户可见文案断言。

## 摸清依据

- `packages/mail/src/features/MailSidebar.tsx:104-113`：管理页导航。
- `packages/mail/src/features/MailAddressManagementFeature.tsx:51-83`：邮箱列表加载。
- `packages/mail/src/ui/MailAddressManagementView/index.tsx:91-108`：管理页标题和列表。
