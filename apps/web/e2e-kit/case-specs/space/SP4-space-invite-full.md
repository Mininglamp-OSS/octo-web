# SP4: Space 已满时禁止加入

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@SP4 @p1 @space @invite @full`

## 目标

验证已登录用户打开成员数达到上限的 Space 邀请链接时，页面展示已满状态并禁用加入操作。

## 前置条件

- 使用 `fixtures-authed.ts` 提供登录态、中文语言和 mock IM runtime。
- Per-case MSW handler: `e2e-kit/msw-handlers/sp4-space-invite-full.ts`
  - `GET /space/invite/SP4-FULL` 返回 `member_count` 等于 `max_users` 的邀请详情。

## 用户操作步骤

1. 打开已登录用户可访问的 Space 邀请链接。
2. 观察 Space 名称、成员数量和加入按钮。

## 预期结果

- 页面显示 Space 名称「SP4 满员组织」。
- 页面显示成员数量 `100/100 人`。
- 加入按钮显示「组织已满」并处于禁用状态。

## 反例

- 成员数达到上限时仍显示可点击的「加入组织」。
- 页面展示满员信息但加入按钮没有禁用，用户仍可提交加入操作。

## 视觉基准

不建 pixel baseline；用用户可见文本和按钮状态断言。

## 摸清依据

- `apps/web/src/Layout/index.tsx:530-545`: 邀请参数进入 `InviteLanding` 页面。
- `apps/web/src/Components/InviteLanding/index.tsx:424-450`: 已登录用户的加入按钮根据 `member_count >= max_users` 显示满员文案并禁用。
- `apps/web/src/i18n/zh-CN.json:29,34`: 满员按钮和错误文案。
- `packages/dmworklogin/src/login_vm.tsx:110`: 邀请详情使用 `space_name`、`member_count`、`max_users` 和 `invite_code` 字段。
