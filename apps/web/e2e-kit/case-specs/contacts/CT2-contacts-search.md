# CT2: 联系人搜索

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@CT2 @p1 @contacts @contacts-search`

## 目标

验证用户可以在通讯录中按联系人名称搜索，并看到匹配结果。

## 前置条件

- 使用 `fixtures-authed.ts` 提供登录态、中文语言和 mock IM 连接。
- `space/{spaceId}/members` 返回「E2E 联系人」和「其他成员」。
- 机器人和群聊接口返回空列表。

## 用户操作步骤

1. 打开通讯录。
2. 在「搜索通讯录」输入 `E2E 联系`。

## 预期结果

- 搜索结果区域显示「联系人」。
- 结果中显示「E2E 联系人」。
- 不匹配的「其他成员」不显示。

## 反例

- 输入关键字后仍显示完整目录，或匹配结果没有联系人名称。

## 视觉基准

不建立 pixel baseline；使用 placeholder 和用户可见文案断言。

## 摸清依据

- `packages/dmworkcontacts/src/ui/ContactsSearch/index.tsx:20-59`：搜索输入和结果区域。
- `packages/dmworkcontacts/src/Contacts/index.tsx:675-710`：搜索结果由联系人索引渲染。
- `packages/dmworkcontacts/src/bridge/contactsSearch/searchContacts.ts:70-82`：名称关键字过滤。
