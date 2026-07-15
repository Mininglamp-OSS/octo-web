# Android / iOS 移动端下载二维码浮窗设计

## 目标

桌面 Web 登录/注册页不再直接下载或跳转移动端安装地址。Android 和 iOS 入口统一使用二维码浮窗，引导用户用手机完成对应平台的安装流程。

## 最终交互

### Android

- 入口使用语义化 `button`，悬停时从按钮下方展示 Semi `Popover`。
- 二维码由 `qrcode.react` 的 `QRCodeSVG` 动态生成，内容为当前部署域名下的 `/download/dmwork.apk` 绝对地址。
- 浮窗保留完整的 GitHub 备用按钮，安全打开：
  `https://github.com/Mininglamp-OSS/octo-android/releases/latest`
- 页面不再请求 `common/updater/android/1.0`，也不在桌面浏览器直接触发 APK 下载。

### iOS

- 入口使用语义化 `button`，悬停时展示二维码；点击只切换浮窗的固定展开状态，点击浮窗外部后关闭。
- 二维码固定编码 TestFlight 地址：
  `https://testflight.apple.com/join/uPrdCcy3`
- 入口本身不跳转、不下载，也不尝试分发 `.ipa`。

## 组件与样式边界

- `AndroidDownloadButton.tsx` 和 `IOSDownloadButton.tsx` 分别封装平台入口、二维码内容及平台特有交互。
- 两个平台复用 `MobileDownloadPopover.css`，统一浮窗外壳、二维码框、标题尺寸和间距。
- Popover 外壳使用 `--wk-bg-surface`、`--wk-border-default`、`--wk-shadow-lg` 和语义圆角、间距 token。
- 二维码固定白色底，保证亮色和暗色主题下都可扫描。
- `login.tsx` 只负责在登录页的唯一下载入口处渲染两个组件。
- 用户可见文案同时维护在 `zh-CN.json` 和 `en-US.json`。
- 两个平台均提供 Storybook 的入口与浮窗内容 Story。

## 无障碍与安全

- 两个触发器使用 `aria-haspopup="dialog"` 和对应的本地化 `aria-label`。
- 二维码容器提供可读标签。
- GitHub 备用入口通过 `noopener,noreferrer` 打开新标签，并清除 `opener`。

## 验证

```bash
pnpm --filter @octo/login test
pnpm i18n:check
pnpm exec stylelint packages/dmworklogin/src/MobileDownloadPopover.css --config stylelint.config.mjs
pnpm exec storybook build --config-dir apps/web/.storybook --output-dir .storybook-static-mobile-download-check
pnpm --filter @octo/web build
git diff --check
```

人工检查登录页和 Storybook 的 `zh-CN` / `en-US`、亮色 / 暗色状态，确认二维码可扫描、按钮尺寸一致、浮窗向下展开且不遮挡主要登录操作。
