# TES11 Settings center notifications

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (设置中心关键交互回归)
- Tags: `@TES11 @p1 @settings-center @notifications`

## 目标

验证用户可以在设置中心的“通知和声音”页面查看通知设置，并切换静音行为与通知选项。

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- Per-case handler: 无；该页面只读取本地运行时状态，交互结果直接反映在 UI。
- 运行环境: Web real-page seed；桌面专属设置项不参与本 case。

## 用户操作步骤

1. 打开设置中心。
2. 点击“通知与声音”。
3. 将“静音行为”改为“仅声音”。
4. 关闭“通知选项”开关。

## 预期结果

- 通知与声音页面显示“静音行为”和“通知选项”。
- 静音行为选择器显示“仅声音”。
- 通知选项开关从开启变为关闭。

## 反例

- 若点击通知页后仍停留在通用页，页面不应显示通知设置控件。
- 若切换通知选项后开关仍为开启，说明用户操作没有反映到 UI。

## 视觉基准

不建 pixel baseline; 用 `getByTestId`、`getByRole` 和 `getByLabel` 断言结构与状态。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/SettingsCenter.tsx:75-76`: 设置中心通过导航项渲染 `SettingsPage`，并按 selectedId 切换页面。
- `packages/dmworkbase/src/Components/NavRail/settingsRegistry.ts:6-8`: 通知页注册为 `notifications` 设置项。
- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:150-176`: 通知页渲染静音行为选择器和通知选项开关，开关状态通过 UI state 更新。
- `apps/web/e2e-kit/fixtures-authed.ts:48-151`: authed fixture 预置本地认证、中文 locale 并进入 real page。
