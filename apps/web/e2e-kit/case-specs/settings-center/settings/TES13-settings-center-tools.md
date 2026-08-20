# TES13 Settings center tools

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@TES13 @p1 @settings-center @tools`

## 目标

验证设置中心工具页能展示当前支持的键盘快捷键和设备/扩展资源。

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- Per-case handler: 无；设备二维码更新接口由 baseline handler 提供稳定响应。

## 用户操作步骤

1. 打开设置中心，将界面语言切换为 English。
2. 进入键盘快捷键。
3. 进入在其他设备上使用 Octo。

## 预期结果

- 键盘快捷键页显示 Voice input、Hold to talk 和 Cancel voice input。
- 键盘快捷键页不显示 New chat 或 Navigation。
- 设备页显示 Android、iPhone、Windows、macOS、Octo Chrome Extension 和 OpenClaw Plugin。
- 设备页显示 Mobile 和 Extensions and connections 分组。
- Android 下载链接指向 Octo Android releases 页面。

## 反例

- 若快捷键页出现已下线的 New chat 或 Navigation，说明页面注册表与实际支持能力不一致。
- 若资源卡片缺少任一已注册资源，说明设备资源配置没有完整渲染。

## 视觉基准

不建 pixel baseline; 只断言页面标题、资源名称、分组和链接。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/settingsRegistry.ts:8-11`: shortcuts 和 devices 工具页注册。
- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:82-85,89-92`: 工具页渲染快捷键和资源页面。
- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:40-65,382-390`: 资源卡片定义、状态和 Android 下载链接。
- `apps/web/e2e-kit/msw-handlers/chat-baseline.ts`: Android/iOS updater baseline handler。
