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
- [ ] 确认构建时已设置 `VITE_OIDC_TRUSTED_ORIGINS`，值包含所有外部 IdP origin（如 `https://sso.company.com`）；验证：产物 `build/electron-config.json` 的 `oidcEndSessionOrigins` 数组不仅含 API origin，还含完整 IdP origin 列表。若该数组只有一条（API origin），则外部 IdP 部署时 OIDC 退出会静默回退到本地退出，IdP session 不会被终止。
- [ ] OIDC 全流程（登录 / 绑定 / 登出）在打包环境端到端通过。
- [ ] IdP 停留 > 5 分钟后完成登录，客户端不被卡在远端页面。
- [ ] IdP 报错 / 取消登录 / 密码到期弹窗等场景，客户端能返回本地登录界面。
