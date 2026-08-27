# CT3: 联系人资料详情

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CT3 @p1 @contacts @contacts-profile`

## 目标

验证用户可以从全部联系人打开真人联系人的资料详情。

## 前置条件

- 使用 `fixtures-authed.ts` 提供登录态、中文语言和 mock IM 连接。
- 成员接口返回资料为「E2E 联系人」的成员。
- mock IM seed 为该成员提供名称和 Octo 号。
- 机器人和群聊接口返回空列表。

## 用户操作步骤

1. 打开通讯录。
2. 在「搜索通讯录」输入「E2E 联系人」。
3. 点击搜索结果中的「E2E 联系人」。

## 预期结果

- 资料详情显示联系人名称「E2E 联系人」。
- 资料详情显示「Octo号」及其值 `e2e-2001`。

## 反例

- 点击联系人后没有打开资料详情，或详情仍处于加载态且没有资料字段。

## 视觉基准

不建立 pixel baseline；使用资料详情中的用户可见字段断言。

## 摸清依据

- `packages/dmworkcontacts/src/Contacts/index.tsx:611-639`：真人联系人点击后打开 `UserInfo`。
- `packages/dmworkcontacts/src/Contacts/index.tsx:963-977`：资料弹窗挂载 `UserInfo`。
- `packages/dmworkbase/src/Components/UserInfo/index.tsx:207-237`：资料名称和 Octo 号渲染。
