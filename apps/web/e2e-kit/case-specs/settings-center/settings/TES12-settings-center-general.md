# TES12 Settings center general

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@TES12 @p1 @settings-center @general`

## 目标

验证用户可以在设置中心通用页切换界面语言，并看到页面文案立即更新。

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- Per-case handler: 无；语言切换通过真实设置页完成。

## 用户操作步骤

1. 打开设置中心通用页。
2. 将界面语言从中文切换为 English。

## 预期结果

- 页面 `html` 的 `lang` 属性变为 `en-US`。
- 通用页显示 English 文案和 `Coming soon`。
- 中文的深色主题状态文案不再显示。

## 反例

- 若选择语言后 `html[lang]` 未更新，说明语言状态没有生效。
- 若页面仍显示中文文案，说明设置中心没有响应语言变更。

## 视觉基准

不建 pixel baseline; 只断言可观察文案和页面属性。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:74-75`: 通用页语言选择器调用 i18n 切换并更新用户语言偏好。
- `packages/dmworkbase/src/Components/NavRail/SettingsCenter.tsx:54-78`: 设置中心默认选择 General 并渲染当前页面。
- `packages/dmworkbase/src/i18n/locales/en-US.json:1364-1371`: English 通用页文案。
