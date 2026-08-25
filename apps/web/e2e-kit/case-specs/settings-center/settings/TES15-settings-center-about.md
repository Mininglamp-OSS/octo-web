# TES15 Settings center about

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@TES15 @p1 @settings-center @about`

## 目标

验证用户可以打开帮助和关于页，看到版本信息、帮助入口和产品链接。

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- Per-case handler: 无；页面内容来自本地配置与 i18n。

## 用户操作步骤

1. 打开设置中心，将界面语言切换为 English。
2. 点击帮助和关于。

## 预期结果

- 页面显示 Help and about 和 Current version。
- 版本信息卡片显示尚未检查状态和 Check for updates 按钮。
- 页面显示 Welcome guide、Changelog、Feedback、Octo website、Octo open source 和 Open-source licenses 入口。
- Feedback、Octo open source 和 Open-source licenses 链接存在正确的外部目标地址。

## 反例

- 若关于页缺少 Current version，说明版本信息没有进入设置中心页面。
- 若外部链接缺失或目标地址错误，说明产品支持入口不可用。

## 视觉基准

不建 pixel baseline; 只断言页面文字和外部链接地址。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:85,179-190`: 关于页信息、帮助入口和外部链接渲染。
- `packages/dmworkbase/src/Components/NavRail/SettingsCenter.tsx:77-78`: 设置中心按注册项渲染 About 页面。
- `packages/dmworkbase/src/i18n/locales/en-US.json:1570-1600`: About 页面 English 文案和链接标签。
