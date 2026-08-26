# CT1: 联系人列表

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0 (阻断)
- Tags: `@CT1 @p0 @contacts @contacts-list`

## 目标

验证用户可以进入通讯录，并看到全部联系人分组及成员数量。

## 前置条件

- 使用 `fixtures-authed.ts` 提供登录态、中文语言和 mock IM 连接。
- `space/{spaceId}/members` 返回当前用户和一名联系人。
- 机器人和群聊接口返回空列表。

## 用户操作步骤

1. 打开应用。
2. 点击侧边栏「通讯录」。
3. 观察「全部联系人」分组。

## 预期结果

- 通讯录页面显示「全部联系人」。
- 「全部联系人」显示成员数量 `(2)`。

## 反例

- 路由或菜单未注册、成员接口未返回数据时，无法进入通讯录或显示联系人数量。

## 视觉基准

不建立 pixel baseline；使用用户可见文案断言。

## 摸清依据

- `apps/web/src/App/index.tsx:125-136`：通讯录菜单和 `/contacts` 路由。
- `packages/dmworkcontacts/src/Contacts/index.tsx:300-390`：页面加载成员数据。
- `packages/dmworkcontacts/src/Contacts/index.tsx:852-905`：全部联系人列表渲染。
