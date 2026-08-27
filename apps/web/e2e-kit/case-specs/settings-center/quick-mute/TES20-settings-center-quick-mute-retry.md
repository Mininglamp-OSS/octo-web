# TES20 Sidebar 快捷静音保存失败重试

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@TES20 @p1 @settings-center @quick-mute @error-state`

## 目标

验证快捷静音保存失败时保留原提醒状态并展示重试入口，用户点击重试后能够完成静音。

## 前置条件

- fixture: `fixtures-authed`，已登录并进入真实 sidebar。
- Per-case handler: `e2e-kit/msw-handlers/tes20-settings-center-quick-mute-retry.ts`
  - 初始 `GET /user/notification-pause` 返回未暂停。
  - 首次 `PUT /user/notification-pause` 返回 HTTP 503。
  - 重试 PUT 返回 30 分钟暂停状态。

## 用户操作步骤

1. 点击 sidebar 的「提醒开启」入口。
2. 点击「静音 30 分钟」。
3. 观察保存失败提示。
4. 点击「重试」。

## 预期结果

- 首次保存失败时显示「保存失败，原状态未改变。」和「重试」按钮。
- 失败期间 sidebar 仍显示「提醒开启」。
- 点击重试后菜单关闭，sidebar 显示「已静音」。

## 反例

- 保存失败后直接显示「已静音」，说明 UI 覆盖了未成功的状态。
- 错误态没有重试入口，用户无法恢复本次操作。

## 视觉基准

不建 pixel baseline；用 role、可见文本和 sidebar 状态断言结构。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/QuickMuteSidebar.tsx:47-65`: 静音保存失败时保留原状态并渲染错误提示和重试入口。
- `packages/dmworkbase/src/Components/NavRail/QuickMuteStore.ts:90-121`: 快捷静音 GET/PUT 状态转换。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:1627-1631`: 保存失败和重试文案。
