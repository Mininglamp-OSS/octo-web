# Electron OIDC 上线迁移说明

本页描述 PR #1365（`feat(electron): support OIDC login and binding`）随 packaged Electron / Tauri 桌面应用上线时，对**现有已登录用户**产生的一次性影响。发版 release note 与运维沟通请引用本页。

## 变更摘要

1. 打包 Electron 客户端首次支持 OIDC 登录与账号绑定；
2. 登录会话新增 `device_flag` 字段，用于区分 Web / Electron / Tauri；
3. 桌面 OIDC 登出由 Electron 主进程在隐藏的沙箱窗口中执行 IdP end-session，主窗口不会跳转到远端页面，也不会弹出系统浏览器；
4. 收窄了 dev 模式下 OIDC 入口的隐藏范围 —— 只有 Electron dev 会隐藏，Web dev 仍可调试 OIDC 流程。

## 用户可见影响：强制一次性重登（桌面端）

### 现象
所有 Electron / Tauri 桌面客户端在**升级到本版本后首次启动时**，会被强制登出一次，需要重新完成账号登录（密码或 OIDC）。

### 原因
本 PR 之前存储的会话令牌未记录 `device_flag`。升级后代码判定"缓存 `deviceFlag !== expectedDeviceFlag`"即视为需要复登，无法在客户端本地伪造该字段。相关代码见 `packages/dmworkbase/src/App.tsx`：

```ts
const hasDeviceFlagMismatch = hasImDeviceFlagMismatch(
  WKApp.loginInfo.isLogined(),
  WKApp.loginInfo.deviceFlag,
  expectedDeviceFlag,
)
if (!this._deviceFlagMigrationHandled && this.isPC && hasDeviceFlagMismatch) {
  WKApp.loginInfo.logout();
}
```

### 触发范围
- ✅ 所有升级到本版本的 Electron 打包客户端（macOS / Windows / Linux）
- ✅ 所有 Tauri 桌面客户端
- ❌ Web 端不受影响（Web 会话的 `device_flag` 与浏览器判定一致）

除 OIDC 和密码登录外，桌面端的用户名注册、邮箱注册和邮箱密码登录也会携带 PC 设备槽位；Web 端继续使用 Web 设备槽位。

### 频率
**恰好一次**。所有登录路径（密码、OIDC、绑定成功后创建会话）都统一走 `applyLoginResp`，会正确写入 `deviceFlag`。第二次启动读到匹配的 `deviceFlag` 后不再触发。

### 建议 release note 文案

> **重要**：桌面客户端（macOS/Windows/Linux 版）本次升级后需要重新登录一次。这是本次桌面 OIDC 单点登录支持所必需的一次性会话字段迁移，之后不会再出现。请在登录后正常继续使用；未启用 OIDC 的租户仍可使用原密码登录。

## 需要在预生产环境验证的项

- [ ] 打包 macOS：升级安装后首次启动确认被登出一次，重新登录后第二次启动不再登出。
- [ ] 打包 Windows：同上，另外验证 `file://` URL 的 `hostname` 归一化对 IPC 通道无影响。
- [ ] Tauri：确认 `deviceFlag` 判定路径与 Electron 一致。
- [ ] 确认构建时已设置 `VITE_OIDC_TRUSTED_ORIGINS`（构建期变量，值会写入产物 `build/electron-config.json.oidcEndSessionOrigins`，运行时改不生效）。该白名单必须覆盖**三类** origin，缺一即在打包桌面端触发静默回退：
  1. **IdP end-session origin**：每个可能接收 `/logout`、`/end_session`、`/signout` 请求的 IdP 主机（如 `https://sso.company.com`）；
  2. **`post_logout_redirect_uri` 目标 origin**：IdP 清完会话后重定向回来的地址所属 origin，通常是 Web 应用 origin，可能与 `VITE_API_URL` 及 IdP 主机都不同（如 `https://app.company.com`）。相对路径（如 `/login`）会按 end-session URL 自身的 origin 解析，无需额外配置；
  3. **联邦流程中间跳转 origin**：主进程现已拦截 `will-redirect` 到非白名单 origin，Microsoft/Auth0 等多域 IdP 的中间跳（如 `login.microsoftonline.com → login.live.com`）也必须列出。

  API origin（`VITE_API_URL`）会自动加入白名单，无需重复填写。验证：产物 `build/electron-config.json` 的 `oidcEndSessionOrigins` 数组包含上述三类 origin；若打包端登出静默回退，主进程控制台会输出 `[oidc] IPC_OIDC_OPEN_EXTERNAL rejected` 并标注具体拒因（`origin` / `redirect-origin` / `redirect-duplicate` / `path` 等）。
- [ ] OIDC 全流程（登录 / 绑定 / 登出）在打包环境端到端通过。
- [ ] IdP 停留 > 5 分钟后完成登录，客户端不被卡在远端页面。
- [ ] IdP 报错 / 取消登录 / 密码到期弹窗等场景，客户端能返回本地登录界面。
