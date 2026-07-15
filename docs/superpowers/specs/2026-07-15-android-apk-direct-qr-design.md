# Android APK 直链回退决策补充

日期：2026-07-15

本文只补充 2026-07-14 Android / iOS 统一二维码浮窗设计中的 APK 地址决策；组件结构、交互与视觉规范以 7 月 14 日文档为准。

## 背景

当前登录/注册页的 Android 下载入口已经改为悬浮二维码浮窗，但二维码区域仍是占位内容。由于暂时来不及接入正式的 Android 发布与对象存储同步流程，本次先恢复原始 APK 下载路径，让用户可以用手机扫码直接下载现有安装包。

## 当前实现目标

- 保留现有 Android 按钮、向下展开的 Popover 和整体视觉样式。
- 将二维码内容设为当前站点同源的 `/download/dmwork.apk` 绝对 URL。
- 用户使用手机扫码后，手机浏览器直接访问 APK 地址并开始下载。
- 浮窗中的 GitHub 按钮继续打开 `Mininglamp-OSS/octo-android` 的最新 Release 页面，供用户查看和手动下载最新版。
- 不恢复 `common/updater/android/1.0` 请求，不修改 `octo-server`，不新增后端依赖。

## URL 规则

APK 路径保持：

```text
/download/dmwork.apk
```

浏览器运行时根据当前页面 origin 生成二维码完整地址。例如登录页位于：

```text
https://octo.example.com/login
```

二维码内容应为：

```text
https://octo.example.com/download/dmwork.apk
```

这样同一份前端可以部署到不同域名，不需要写死生产域名。服务端或部署层必须继续保证 `/download/dmwork.apk` 可访问。

GitHub 备用入口使用最新 Release 页面：

```text
https://github.com/Mininglamp-OSS/octo-android/releases/latest
```

## 组件改动

- 在 `AndroidDownloadButton.tsx` 中导出稳定的 APK 路径常量。
- 增加根据浏览器当前 origin 生成完整 APK URL 的小函数，并为 SSR/测试环境提供可预测的同源回退值。
- 使用项目已有的 `qrcode.react` / `QRCodeSVG` 替换二维码占位区域。
- GitHub 按钮继续安全地在新标签页打开，但目标调整为最新 Release 页面。
- 复用现有国际化文案和 `MobileDownloadPopover.css`，不新增用户可见文案，不改变布局。

## Android 与 iOS 弹窗一致性

- Android 与 iOS 使用同一个二维码框样式，不再分别维护占位框和无边框二维码容器。
- 二维码框统一为 120px（`calc(var(--wk-sp-12) * 2 + var(--wk-sp-6))`），避免 iOS 二维码在 240px 宽弹窗中过度抢占视觉空间。
- 两个平台统一使用固定白色二维码底、边框、圆角和内边距，保证明暗主题下均可扫描。
- 标题字号、二维码与标题间距继续复用共享样式。
- Android 因为保留 GitHub 备用按钮，弹窗高度可以高于 iOS；二维码和标题区域必须保持一致。

## 测试与验收

自动化测试覆盖：

- APK 固定路径仍为 `/download/dmwork.apk`。
- 给定页面 origin 时，二维码值会生成同源的完整 APK URL。
- Popover 服务端渲染结果包含二维码 SVG，不再包含占位提示。
- GitHub 按钮指向 `octo-android/releases/latest`。

验证命令：

```bash
pnpm --filter @octo/login test
pnpm i18n:check
pnpm --filter @octo/web build
git diff --check
```

手工验收：桌面浏览器悬浮、触屏或键盘点击 Android 按钮均可显示二维码，手机扫码后访问当前部署域名下的 `/download/dmwork.apk`；点击 GitHub 按钮打开最新 Release 页面。

## 后续正规方案

正式方案不是把 APK 提交进 `octo-server`。Octo 部署层会把 `/download/...` 转发到 MinIO 的 `download` 存储桶，因此后续应建立以下发布链路：

```text
octo-android 构建签名 APK
  -> 上传 MinIO 或国内 OSS
  -> 更新固定下载对象或稳定下载入口
  -> 验证 Content-Type、Content-Disposition、缓存和 SHA-256
```

具备生产对象存储权限后，再把当前旧包替换为新版 APK；二维码地址无需改变。
