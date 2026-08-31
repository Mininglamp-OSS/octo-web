# CT4: 通讯录搜索无结果

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CT4 @p1 @contacts @contacts-search`

## 目标

验证通讯录搜索没有匹配联系人时展示明确空结果，而不是继续显示完整联系人列表。

## 前置条件

- 使用 `fixtures-authed.ts` 和 mock IM runtime。
- 成员接口返回「E2E 联系人」和「其他成员」。

## 用户操作步骤

1. 打开通讯录。
2. 在「搜索通讯录」输入「不存在的人」。

## 预期结果

- 页面显示「没有找到相关联系人」。
- 「E2E 联系人」和「其他成员」均不显示。

## 反例

- 无匹配时仍显示完整目录，或搜索区域保持空白。

## 视觉基准

不建 pixel baseline；用用户可见文本断言。

## 摸清依据

- `packages/dmworkcontacts/src/ui/ContactsSearch/index.tsx:38-58`: 无结果时渲染空态。
- `packages/dmworkcontacts/src/Contacts/index.tsx:675-710`: 搜索结果和空态文案接入。
- `packages/dmworkcontacts/src/i18n/zh-CN.json:40`: 无结果文案。
