# TES19 Sidebar 快捷静音

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@TES19 @p1 @settings-center @quick-mute @sidebar`

## 目标

验证用户可以直接从 sidebar 打开快捷静音菜单，选择 30 分钟静音后看到 sidebar 状态变为“已静音”，并能再次打开菜单恢复提醒。

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- 需要覆盖的 baseline handler: auth、space、IM empty seed 及 `GET /user/notification-pause`
- Per-case MSW handler: `e2e-kit/msw-handlers/tes19-settings-center-quick-mute.ts`
  - `GET/PUT/DELETE /user/notification-pause` — 分别返回初始未暂停、暂停 30 分钟、恢复后的真实响应字段
- 使用 real-page seed，不使用 harness route；case 从真实 sidebar 入口开始。

## 用户操作步骤

1. 打开已登录页面，观察 sidebar 的快捷静音入口。
2. 点击“提醒开启”，打开“暂停通知”菜单。
3. 点击“静音 30 分钟”。
4. 再次点击 sidebar 上显示的“已静音”入口。
5. 点击“恢复提醒”。

## 预期结果

- 初始 sidebar 入口显示“提醒开启”。
- 菜单显示标题“暂停通知”和“静音 30 分钟”选项。
- 选择 30 分钟后菜单关闭，sidebar 入口变为“已静音”。
- 已静音状态再次打开菜单时显示“恢复提醒”。
- 恢复后菜单关闭，sidebar 入口恢复显示“提醒开启”。

## 反例

- 如果静音结果没有回写到共享 store，选择 30 分钟后 sidebar 仍显示“提醒开启”，case 应失败。
- 如果 active 状态没有提供恢复入口，已静音菜单中找不到“恢复提醒”，case 应失败。
- 如果恢复结果没有回写到 sidebar，恢复后仍显示“已静音”，case 应失败。

## 视觉基准

不建 pixel baseline; 用 `getByRole` + `getByText` 断言结构。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/QuickMuteSidebar.tsx:10-18`: sidebar 维护加载、静音和恢复状态。
- `packages/dmworkbase/src/Components/NavRail/QuickMuteSidebar.tsx:43-65`: 静音菜单、30 分钟操作、恢复入口和 UI 文案。
- `packages/dmworkbase/src/Components/NavRail/QuickMuteStore.ts:3-19`: `QuickMuteState`、duration 和 service 接口。
- `packages/dmworkbase/src/Components/NavRail/QuickMuteStore.ts:90-121`: `/user/notification-pause` 的 GET/PUT/DELETE 调用与响应转换。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:1610-1630`: sidebar 状态、操作和菜单中文文案。
