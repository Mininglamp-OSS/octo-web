# TES10 Settings center shell

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0 (设置中心主流程)
- Tags: `@TES10 @p0 @settings-center @shell`

## 目标

验证登录用户可以从主界面打开设置中心，看到 Web 环境可用的默认页面并正常退出设置中心。

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- Per-case handler: 无；本 case 使用设置中心真实页面和本地运行时状态，不依赖额外 HTTP 业务数据。
- Web 环境：桌面专属设置项不应出现在设置中心导航中。

## 用户操作步骤

1. 打开主界面。
2. 打开设置中心。
3. 观察默认选中的通用页面和 Web 能力过滤结果。
4. 退出设置中心。

## 预期结果

- 设置中心打开后默认选中通用页面。
- Web 设置中心不显示“桌面应用”分组。
- 默认内容页显示通用页面内容。
- 点击退出后设置中心关闭。

## 反例

- 若 Web 环境错误显示桌面应用分组，说明运行环境能力过滤失效。
- 若默认页面不是通用页，说明 shell 初始导航状态没有正确建立。
- 若退出后设置中心仍可见，说明关闭流程没有完成。

## 视觉基准

不建 pixel baseline; 用 `getByTestId`、`getByRole`、`getByText` 和页面属性断言结构与状态。全局 Playwright 配置在失败时保留 trace、截图和视频，不提交本地视觉基线。

## 摸清依据

- `apps/web/e2e-kit/tests/settings-center/shell/TES10-settings-center-shell.spec.ts:4-17`: shell smoke 覆盖设置中心入口、默认页、能力过滤和退出。
- `apps/web/e2e-kit/fixtures-authed.ts:48-151`: authed fixture 预置认证、中文 locale、已完成 onboarding，并进入真实页面。
- `packages/dmworkbase/src/Components/NavRail/SettingsCenter.tsx:45-76`: 设置中心渲染导航、当前页面和退出入口，并在关闭后重置页面状态。
- `packages/dmworkbase/src/Components/NavRail/settingsRegistry.ts:6-22`: 设置分组、页面注册及 desktop capability 过滤入口。
- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:20-178`: 通用、通知、快捷键、设备和关于页面的真实 UI 内容。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:1317-1440`: 设置中心中文标题、分组、页面和状态文案。
- `packages/dmworkbase/src/i18n/locales/en-US.json:1317-1440`: 设置中心英文标题、分组、页面和状态文案。
