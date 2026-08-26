# ML1: Mail 空收件箱

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0 (阻断)
- Tags: `@ML1 @p0 @mail @mail-inbox`

## 目标

验证 Mail 功能开关开启后，用户可以进入 Agent Mail 的 Inbox，并看到空收件箱状态。

## 前置条件

- `common/appconfig` 返回 `mail_on=1`。
- Agent mailbox、Inbox mailbox、identity 接口返回有效 mock 数据。
- messages 接口返回空列表。

## 用户操作步骤

1. 打开应用。
2. 点击侧边栏「Mail」。
3. 观察 Inbox。

## 预期结果

- Mail 页面显示 Agent Mail。
- 当前邮箱显示 Inbox。
- 空收件箱显示「暂无邮件」及说明文案。

## 反例

- Mail 开关开启后没有导航入口、邮箱数据未加载，或空态区域持续 loading。

## 视觉基准

不建立 pixel baseline；使用角色和用户可见文案断言。

## 摸清依据

- `packages/mail/src/module.tsx:54-84`：Mail 路由、菜单和开关。
- `packages/mail/src/features/MailSidebar.tsx:45-55`：默认打开 Inbox。
- `packages/mail/src/ui/MailRecordsView/index.tsx:128-145`：空收件箱渲染。
