# OCTO Maui — PC 客户端（.NET MAUI）

> OCTO 消息平台的原生跨平台客户端，基于 .NET MAUI 构建。
> 一套代码，同时面向 Windows、macOS（Mac Catalyst）、Android 和 iOS。

这是现有 Electron PC 客户端（[`apps/web/src-election`](../../web/src-election)）的
C# / .NET MAUI 同类产品。两者均通过 REST + WebSocket 与
[`octo-server`](https://github.com/Mininglamp-OSS/octo-server) 通信；本项目提供
原生 .NET 桌面体验，Electron 则保留 Web 技术栈路线。

## 为什么要有第二个 PC 客户端？

| | Electron（`apps/web`） | .NET MAUI（`apps/octo-maui`） |
|---|---|---|
| 技术栈 | TypeScript / React | C# / .NET 8 |
| 运行时 | Chromium + Node | 原生 .NET |
| 适用场景 | Web 开发者，与浏览器共享 UI | 原生 Windows 集成，.NET 生态 |
| 安装包体积 | 较大（~150 MB） | 较小（~30 MB） |

两者均为一等公民，按团队技术栈选择即可。

## 前置条件

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)（LTS）
- MAUI 工作负载：`dotnet workload install maui`
- Windows：Visual Studio 2022 17.8+（含"MAUI"工作负载），或 `dotnet` CLI
- macOS：`dotnet workload install maui` + Xcode（用于 iOS / MacCatalyst 构建）

## 构建与运行

```bash
cd apps/octo-maui

# 还原依赖 + Windows 运行
dotnet restore
dotnet build -t:Run -f net8.0-windows10.0.19041.0

# 或 Mac Catalyst 运行
dotnet build -t:Run -f net8.0-maccatalyst
```

客户端首次启动时会进入**引导式服务端配置页面**，由用户输入要连接的
`octo-server` 地址。也可通过环境变量 `OCTO_API_BASE` 预设默认地址。

## 核心功能

### 引导式服务端连接

首次启动时，用户不会面对一个空白登录页，而是一个分步引导流程：

1. **输入服务端地址** — 支持域名或 IP，自动补全 `https://` 并规范化为 origin
2. **测试连接** — 分步验证：Ping 服务器（5 秒超时）→ 探测 `/v1/common/appconfig`
   获取服务端能力（OIDC 提供商等），全程**不保存**地址，用户可随时取消
3. **能力预览** — 连接成功后展示卡片，列出可用的登录方式（企业 SSO · 账号密码）
   和 SSO 提供商名称
4. **保存并继续** — 确认后才持久化地址，自动跳转到登录页

此外支持**服务端历史记录**（最多 5 条），再次连接时可一键选择，无需重新输入。

### 企业 OIDC / SSO 登录

企业部署的 `octo-server` 可能接入自有的 passport 系统（而非 octo 自带用户系统）。
客户端完整支持此类登录流程：

1. 从服务端 `appconfig` 发现 OIDC 提供商列表
2. 获取一次性 authcode（`GET /v1/user/thirdlogin/authcode`）
3. 打开系统浏览器跳转到企业登录页（`{authorizePath}?authcode=...&flag=1`）
4. 轮询登录状态（`GET /v1/user/thirdlogin/authstatus`，每 2 秒，最长 5 分钟）
5. 登录成功后保存 token，进入聊天

OIDC 按钮和本地账号密码登录共存于同一页面，用户自由选择。

### 主题系统

- 浅色 / 深色 / 跟随系统三种模式
- 登录页、聊天页、服务端配置页均有主题切换按钮
- 通过合并 / 移除 `ColorsDark` 资源字典实现，无需重启应用

### 聊天体验

- 左侧频道列表（含未读计数）
- 消息列表支持流式回复、Agent 身份标识（🦞 头像 + 强调色边框）
- 新消息自动滚动到底部
- 友好的时间格式（今天 HH:mm / 昨天 HH:mm / MM-dd HH:mm / yyyy-MM-dd HH:mm）
- 空状态遮罩提示

### Markdown 渲染

AI Agent 的回复以 Markdown 格式呈现，由原生 `MarkdownView` 控件渲染（无 WebView 依赖）：

- 支持代码块（`` ``` ``）、标题（`#`）、粗体（`**text**`）、内联代码（`` `code` ``）、列表
- 代码块使用平台原生等宽字体（Windows: Cascadia Code，Apple: Menlo）
- 主题切换时自动重新渲染（监听 `RequestedThemeChanged` 事件）
- 未闭合代码块容错处理（不跳过末尾行）
- 正则表达式预编译为 `static readonly`，避免重复编译开销

### 拖拽上传

- 聊天区域支持拖拽文件 / 图片直接上传（`DropGestureRecognizer`）
- 使用 MAUI 原生 `DropEventArgs.Data` API（`e.Data.GetTextAsync()`），跨平台兼容
- macOS 拖拽的 `file://` URI 自动转换为本地路径
- 拖拽悬停时显示视觉反馈（`IsDragOver` 状态）
- 支持多文件批量上传，`IsUploading` 在整个批次期间保持 true（不闪烁）
- 单个文件失败不影响其余（continue 而非 return）

### 流式回复渲染

AI Agent 的回复以流式方式实时呈现：

- WebSocket 接收 `stream_start` / `stream_chunk` / `stream_end` 三阶段事件
- 跨帧消息使用 `MemoryStream` 累积原始字节，`EndOfMessage` 后一次性 UTF-8 解码，
  避免多字节字符（CJK / emoji）在 64KB 帧边界处乱码
- 切换频道时清理 `_streamingMessages`，防止跨频道的流式占位符残留
- 流式过程中显示"🦞 Lobster 正在思考…"指示器和 spinner
- 消息内容增量追加，流式中显示"● 输入中…"标记
- 流式完成后标记转为正常消息

### 文件 / 图片上传

- 聊天输入区提供 📎（文件）和 🖼️（图片）两个附件按钮
- 通过 `FilePicker` 选择文件，`multipart/form-data` 上传到服务端
- 消息列表中图片直接预览（最大高度 200px），文件显示为卡片（文件名 + 大小）
- 文件大小自动格式化（B / KB / MB / GB）

### 系统托盘集成

- `ITrayService` 抽象接口，跨平台兼容（非 Windows 平台为 no-op）
- Windows 平台通过 `WindowsTrayService` 完整实现 Win32 P/Invoke：
  - `Shell_NotifyIconW` 管理托盘图标（添加 / 删除 / 修改）
  - 消息专用窗口（`HWND_MESSAGE`）接收托盘回调
  - `TrackPopupMenu` 右键菜单（显示窗口 / 退出）
  - 实现 `IDisposable`，确保原生资源正确释放
  - `InitializeAsync` 返回可等待的 `Task`（`TaskCompletionSource`）
- 窗口关闭时可最小化到托盘而非退出
- 托盘右键菜单：显示窗口 / 退出

### 自动更新

- 启动时非阻塞检查 `GET /v1/common/version` 获取最新版本
- Semver 比较（`major.minor.patch`），发现新版本时弹窗提示
- 用户可选择"确定"打开下载页面，或"稍后"跳过
- 版本检查失败静默忽略，不影响正常使用

### 窗口管理（Windows）

- 默认窗口 1180×760，最小 880×560
- 窗口位置和尺寸持久化（基于 `Preferences`）
- 拖拽调整大小时防抖保存（500ms `CancellationTokenSource`，避免写入风暴）
- 动态标题栏显示当前用户名（`OCTO — <user>`）

## 项目结构

```
apps/octo-maui/
├── OctoMaui.sln
└── src/OctoMaui/
    ├── OctoMaui.csproj          # MAUI 项目文件（多目标）
    ├── MauiProgram.cs           # DI 容器 + 启动配置
    ├── App.xaml(.cs)            # 应用根（窗口管理 + 主题初始化）
    ├── AppShell.xaml(.cs)       # Shell 路由（服务端配置 → 登录 → 聊天）
    ├── Pages/                   # XAML 页面
    │   ├── ServerConfigPage     #   引导式服务端配置
    │   ├── LoginPage            #   登录（OIDC + 账号密码）
    │   └── ChatPage             #   聊天主界面（含拖拽上传）
    ├── Controls/                # 自定义控件
    │   └── MarkdownView         #   Markdown 渲染器（代码块/标题/粗体/内联代码）
    ├── ViewModels/              # MVVM ViewModel
    │   ├── ViewModelBase        #   INotifyPropertyChanged + Command 基类
    │   ├── ServerConfigViewModel#   分步验证 + 历史记录 + 能力预览
    │   ├── LoginViewModel       #   本地登录 + OIDC 轮询
    │   └── ChatViewModel        #   消息收发 + WebSocket
    ├── Models/                  # 数据模型
    │   ├── User / Message / Channel
    │   ├── ServerInfo           #   服务端能力（OIDC 提供商等）
    │   └── ServerHistoryEntry   #   历史记录条目
    ├── Services/                # 服务层
    │   ├── ApiService           #   REST 客户端（含文件上传 UploadFileAsync）
    │   ├── AuthService          #   会话管理（token 持久化 + OIDC 登录）
    │   ├── ServerConfigService  #   服务端地址管理 + ProbeAsync 探测
    │   ├── ServerHistoryService #   历史记录（JSON 存储，最多 5 条）
    │   ├── WebSocketService     #   实时消息（含流式 stream_start/chunk/end）
    │   ├── ThemeService         #   主题切换
    │   ├── TrayService          #   系统托盘（跨平台抽象 + Windows 实现）
    │   └── UpdateService        #   自动更新（版本检查 + semver 比较）
    ├── Resources/               # 样式、颜色、图标、启动屏
    │   ├── Colors.xaml          #   浅色色板 + 转换器
    │   ├── Colors.Dark.xaml     #   深色色板
    │   └── Styles.xaml          #   通用样式（PrimaryButton / GhostButton）
    └── Platforms/               # 各平台配置（Windows / Android / iOS / Mac）
```

## 架构

采用 MVVM 模式，手写 `ViewModelBase`（无外部 MVVM 工具包依赖，零隐藏魔法）：

- **Pages** 是纯 XAML + code-behind，通过 `BindingContext` 绑定到 ViewModel
- **ViewModels** 通过 `ViewModelBase` 实现 `INotifyPropertyChanged`，用
  `ConcurrentDictionary` 线程安全存储属性值，`CreateCommand` 辅助创建命令
  （含 `Func<Task>` 重载，避免 async-void）
- **Services** 通过 `MauiProgram` 依赖注入容器注册，在构造函数中注入
- **Models** 对应 `octo-server` 的 REST 数据结构
- **三层路由**：未配置服务端 → 服务端配置页；已配置未登录 → 登录页；已登录 → 聊天页
- **资源释放**：`ChatViewModel`、`LoginViewModel`、`ServerConfigViewModel` 和
  `WindowsTrayService` 实现 `IDisposable`。`LoginPage` / `ServerConfigPage` 在
  `OnNavigatedFrom` 中调用 `Dispose()` 取消订阅单例事件，防止 Transient ViewModel
  内存泄漏。`ChatPage` 不在导航时释放（WebSocket 推送只在构造函数订阅一次，
  导航释放会导致永久失聪），清理通过 `LogoutAsync` / `SwitchServerAsync` 完成

### 关键设计：ProbeAsync（探测不保存）

`ServerConfigService.ProbeAsync(url)` 是引导式配置的核心：

- 临时切换 `ApiService` 的 BaseUrl 到候选地址
- 调用 `GetServerInfoAsync()` 获取服务端能力
- 在 `finally` 块中恢复原 URL
- **不触发 `ServerChanged` 事件**，用户留在配置页查看预览

这避免了"验证即保存即跳转"的问题——用户可以先确认服务端能力，再决定是否保存。

## 服务端 API 契约

客户端使用以下 `octo-server` 端点：

| 端点 | 方法 | 用途 | 状态 |
|---|---|---|---|
| `/` | GET | Ping 连通性检查（任意 HTTP 响应即可） | ✅ |
| `/v1/user/login` | POST | 本地用户名密码登录（flat 响应：`{token, uid, name, ...}`） | ✅ |
| `/v1/user/current` | GET | 获取当前用户信息（需 token） | ✅ |
| `/v1/message/send` | POST | 发送消息（flat 路径，`channel_id` 在 payload） | ✅ |
| `/v1/file/upload` | POST | 上传文件 / 图片（multipart/form-data，`channel_id` 在表单） | ✅ |
| `/v1/common/appconfig` | GET | 获取服务端配置（含 OIDC 提供商） | ✅ |
| `/v1/common/version` | GET | 获取最新客户端版本（用于自动更新检查） | WIP |
| `/v1/user/thirdlogin/authcode` | GET | 获取 OIDC 一次性授权码 | ✅ |
| `/v1/user/thirdlogin/authstatus` | GET | 轮询 OIDC 登录状态 | ✅ |

> 认证 header 为 `token: <value>`（非 `Bearer`），与 web 客户端一致。
> MAUI 是直连客户端（非 nginx 反代），所有 REST 端点统一使用 `/v1/` 前缀。

### 已知限制（WIP）

octo-server 的实时通讯使用 **WuKongIM**（非自定义 `/ws` + JSON 协议）。以下功能
为 scaffold，等待 WuKongIM .NET 客户端实现后替换：

- **WebSocketService** — 当前实现假设 JSON-over-`/ws` 协议。真实服务器使用
  WuKongIM cmd-based 二进制协议，IM 地址通过 `GET /v1/users/:uid/im` 动态获取
  （`GetImAddressAsync` 已实现，等待 WuKongIM .NET SDK 接入后替换协议层）。
- **频道列表（GetChannelsAsync）** — 返回空列表。真实对话列表通过 WuKongIM
  `wkstore.sync` 获取。
- **消息历史（GetMessagesAsync）** — 返回空列表。真实消息历史通过 WuKongIM
  sync API 获取。
- **消息发送（SendMessageAsync）** — 抛出 `NotImplementedException`。真实消息
  发送走 WuKongIM `chatManager.send`，当前 MAUI 客户端通过 `WebSocketService.SendAsync`
  发送（scaffold），待 WuKongIM .NET SDK 接入后替换。
- **stream_start / stream_chunk / stream_end 事件** — 当前 `WebSocketService` 暴露
  的三个流式事件为 scaffold，真实服务器通过 `Message.streamOn` + `streamFlag`
  状态字段驱动流式渲染（参照 `packages/dmworkbase/src/Service/Model.tsx`）。

## 开发状态

已完成：
- ✅ 引导式服务端配置（分步验证 + 能力预览 + 历史记录）
- ✅ 本地账号密码登录（`POST /v1/user/login` + flag=2 + device）
- ✅ 邮箱登录（`POST /v1/user/emaillogin`）
- ✅ 用户名注册（`POST /v1/user/usernameregister`）
- ✅ 邮箱注册（`POST /v1/user/emailregister` + `POST /v1/user/email/sendcode`）
- ✅ 忘记密码（`POST /v1/user/email/forgetpwd` + `POST /v1/user/email/sendcode`）
- ✅ 二维码扫码登录（`GET /v1/user/loginuuid` + 轮询 `GET /v1/user/loginstatus` + `POST /v1/user/login_authcode/{authCode}`）
- ✅ 企业 OIDC / SSO 登录（authcode 轮询 + 多 IdP + 第三方 passport/OAuth 支持）
- 🚧 聊天界面（消息列表 + 频道侧边栏 + WebSocket）— 等待 WuKongIM .NET SDK
- ✅ 主题系统（浅色 / 深色 / 跟随系统 + MarkdownView 主题响应）
- ✅ 窗口管理（位置持久化 + 最小尺寸限制 + 防抖保存）
- 🚧 流式回复渲染（stream_start / stream_chunk / stream_end + 打字指示器）— 等待 WuKongIM .NET SDK
- ✅ Markdown / 代码块渲染（MarkdownView 控件 + 主题响应 + 未闭合代码块容错）
- ✅ 文件 / 图片上传（两步预签名直传 + FilePicker + 图片预览 + 文件卡片）
- ✅ 拖拽上传支持（DropGestureRecognizer + 多文件批量上传 + 失败继续）
- ✅ 系统托盘集成（Win32 Shell_NotifyIconW 完整实现 + 右键菜单 + IDisposable）
- 🚧 自动更新（GET /version.json 静态文件 + semver 比较 + 启动时弹窗提示）— DownloadUrl 需服务端提供

### 质量改进（第二轮严格审阅）

基于编码、编译、兼容性和安全四个维度的严格审阅，修复 25 个问题：

**线程安全 / 编译**：
- `ApiService`: `Interlocked.Exchange` 原子替换 HttpClient，channelId URL 编码
- `WebSocketService`: await receiveLoop 后再 Dispose socket，buffer 增至 64KB
- `ChatViewModel`: 实现 `IDisposable` 取消订阅事件，Token null 检查
- `App.xaml.cs`: 移除 null-forgiving `!`，`AuthStateChanged` 防重复订阅
- `MauiProgram`: 默认 BaseUrl 改为 `https://`，环境变量过 `NormalizeUrl` 验证
- `WindowsTrayService`: 实现 `IDisposable`，`InitializeAsync` 返回可等待 Task

**编码规范**：
- `AuthService`: `OperationCanceledException` 重抛，移除无意义 `await Task.CompletedTask`
- `AppShell`: fire-and-forget 改顺序 await，`Navigate` 改为 `async Task`
- `ViewModelBase`: `ConcurrentDictionary` 线程安全属性存储

**兼容性**：
- `MarkdownView`: 监听 `RequestedThemeChanged` 重新渲染，代码块未闭合容错
- `ApiService`: `AllowInsecureSsl` 选项支持自签名证书（内部部署）

**安全**：
- Token 从 `Preferences` 迁移到 `SecureStorage`（DPAPI / Keychain / KeyStore）
- WebSocket 移除 URL query string 中的 token，仅用 `token` header
- `NormalizeUrl` 拒绝非 localhost 的 cleartext HTTP

### 质量改进（第三~五轮 PR 审阅修复）

基于 PR #578 三位 reviewer（yujiawei、Jerry-Xin、OctoBoooot）的多轮审查反馈，
共修复 29 个问题：

**第三轮**（commit `55f2d032`，9 个）：
- REST 端点统一加 `/api/v1` 前缀，认证 header 改为 `token: <value>`（非 `Bearer`）
- WebSocket token 从 URL query 移至 `token` header
- OIDC JSON 字段改为 snake_case（`authorize_path` / `account_url` / `reset_password_url`）
- `AllowInsecureSsl` 证书绕过限制为 loopback（`IPAddress.IsLoopback`）
- `WebSocketUrl` 用 `UriBuilder` 构建（不再 `.Replace` 链式调用）
- 图片 URL 安全校验（`SafeImageUrl`，仅允许 http/https scheme）

**第四轮**（commit `06c99f43`，12 个）：
- `ViewModelBase` 新增 `IsBusy` 属性（CS0103 编译错误）
- `CreateCommand<T>` canExecute arity 修正（`() => !IsBusy` → `_ => !IsBusy`）
- `ChatPage.OnDrop` 移除 WinUI `StandardDataFormats` 引用
- `App.xaml.cs` CreateWindow 改用 `activationState.Context.Services`（Handler 为 null）
- `ChatViewModel.SendAsync` 发送失败恢复草稿
- `ChatViewModel.InitializeAsync` 检查 `HydrateCurrentUserAsync` 返回值
- `ServerConfigViewModel.ContinueAsync` 添加 `finally { IsBusy = false }`
- `WebSocketService` 消息大小上限 1MB（防止内存耗尽）
- `UpdateService` 静态复用 `HttpClient`（防止 socket 耗尽）
- `ChatPage.OnMessagesChanged` 延迟 lambda 内重检 count
- 窗口位置 clamp 到显示器边界
- macOS `file://` URI 转换为本地路径

**第五轮**（commit `cba886b3`，8 个）：
- `ChatPage.OnDrop` 修正 `e.DataPackage.View` → `e.Data`（MAUI 原生 API，最后一个编译阻断）
- `WebSocketService` 跨帧 UTF-8 解码改用 `MemoryStream` 累积（防止 CJK/emoji 乱码）
- `ChatViewModel` 切换频道时清理 `_streamingMessages`
- `LoginViewModel` / `ServerConfigViewModel` 实现 `IDisposable` + 页面 `OnNavigatedFrom` 释放
- `ChatPage.OnNavigatedFrom` 移除 `Dispose()`（防止 WebSocket 推送永久失聪）
- `ApiService.BuildAuthorizeUrl` 用 `Uri.TryCreate` + scheme 校验（防止 `httpevil://`）
- `ChatViewModel.HandleDropAsync` `IsUploading` 改为包裹整个批次
- `AndroidManifest.xml` `allowBackup="false"`（防止 `adb backup` 提取 token）

**第六轮**（yujiawei API 契约审阅，5 个）：
- **P0-3 登录响应**：`LoginResult` 从嵌套 `{Token, User:{Id}}` 改为 flat
  `{token, uid, name}`，`User.Id` JSON 映射改为 `uid`，新增 `ToUser()` 方法
- **P0-2 REST 端点**：`/channel/{id}/message/send` → flat `/v1/message/send`，
  `/channel/{id}/message/upload` → flat `/v1/file/upload`；`/channel/list` 和
  `/channel/{id}/messages` 标记为 WIP（依赖 WuKongIM sync，返回空列表）
- **P0-1 WebSocket 协议**：`WebSocketService` 和 `ApiOptions.WebSocketUrl` 添加
  WIP 注释，说明服务器使用 WuKongIM cmd-based 二进制协议（非 JSON-over-`/ws`）
- **P1-1 REST base prefix**：所有 `/api/v1/` 统一改为 `/v1/`（MAUI 为直连客户端，
  非 nginx 反代，与 web 客户端的 `origin + "/v1/"` 一致）
- **P1-2 auto-update 端点**：`UpdateService` 添加 WIP 注释，说明
  `/v1/common/version` 可能不存在，检查为 best-effort

**第七轮**（深度对照 octo-web/server 真实代码，22 个问题，6 P0 + 10 P1 + 6 P2）：

全面审查所有功能是否都基于 octo-web/server 真实代码实现，消除所有"假设"而非
"基于真实代码"的部分。同时增强对第三方部署 octo 系统时使用其他 passport/OAuth
认证的登录支持。

P0 修复（6 个）：
- **P0-1 登录 payload**：`LoginAsync` 添加 `flag = 2`（PC 客户端）和 `device`
  对象（参照 `login_vm.tsx` requestLoginWithUsernameAndPwd）。`LoginResult`
  补全 flat 字段：`app_id`、`short_no`、`sex`、`realname_verified`、`real_name`、
  `realname_verified_at`、`language`
- **P0-2 文件上传协议**：重写为两步预签名直传（参照
  `UploadCredentials.ts` uploadChatMedia）：`GET /v1/file/upload/credentials`
  → `{uploadUrl, downloadUrl, contentType, contentDisposition?}` → `PUT` raw
  body → 返回 `downloadUrl`。移除虚构的 multipart/form-data 实现
- **P0-3 版本检查**：`GET /v1/common/version` → `GET /version.json?_={timestamp}`
  静态文件（参照 `versionChecker.ts`），`VersionInfo` 只保留 `version` + `force`
- **P0-4 消息模型**：`MessageType` 枚举修正为 `Text=1, Image=2, Gif=3, Voice=4,
  SmallVideo=5, File=8, RichText=14`（参照 `Const.ts` MessageContentTypeConst），
  移除虚构的 `System=4, ToolCall=5`。`Message` JSON 映射修正：
  `Id`→`messageID`、`FromUid`→`fromUID`、`Type`→`contentType`、`IsStreaming`→`streamOn`，
  新增 `StreamFlag` 属性
- **P0-5 频道模型**：`ChannelType` 枚举修正为 `Person=1, Group=2, CommunityTopic=5`
  （参照 `Const.ts` ChannelTypeConst），移除虚构的 `Direct=1, Agent=3`。`Channel`
  JSON 映射修正：`Id`→`channelID`、`Type`→`channelType`
- **P0-6 消息发送 WIP**：`SendMessageAsync` 标记为 WIP 并抛出
  `NotImplementedException`（`/v1/message/send` 端点不存在，消息发送走 WuKongIM
  `chatManager.send`）。`GetChannelsAsync`/`GetMessagesAsync` 同步标记为 WIP

P1 修复（10 个）：
- **P1-1 OIDC return_to**：`BuildAuthorizeUrl` 添加 `returnTo` 参数（默认 `/login`），
  支持第三方部署使用其他 passport/OAuth 认证的自定义回调路径
- **P1-2 OIDC 安全校验**：新增 `IsSafeAuthorizePath`（必须 `/` 开头且非 `//`）
  和 `SanitizeHttpUrl`（仅 http/https），参照 `OidcConfig.ts`
- **P1-3 OIDC flag**：`BuildAuthorizeUrl` 追加 `flag=2`（PC 客户端标识）
- **P1-4 legacy_password_login_off**：`ServerInfo` 新增 `LegacyPasswordLoginOff`
  字段，`ServerConfigViewModel.PreviewAuthModes` 在该字段为 true 时不显示"账号密码"
- **P1-5 CurrentUser 恢复**：`AuthService.HydrateCurrentUserAsync` 改为从
  `Preferences` 恢复用户信息（参照 `loginSession.ts` applyLoginResp），不再调用
  `GET /v1/user/current`（该端点仅支持 PUT 更新）
- **P1-6 PingAsync**：`GET /` → `GET /v1/common/appconfig`，返回条件改为
  `resp.IsSuccessStatusCode`（同时验证可达性和 octo-server 身份）
- **P1-7 ServerConfigService.ProbeAsync**：重写为使用独立 `HttpClient`（不修改
  全局 `_api`/`_options`），新增 `CreateProbeClient()` 和 `ParseServerInfo()`
- **P1-8 GetImAddressAsync**：`WebSocketService` 新增 `GET /v1/users/{uid}/im`
  调用（参照 `datasource.ts` imConnectAddrs）
- **P1-9 User 模型**：`IsAgent`(bool) → `Robot`(int)，新增 `Sex`(int) 和
  `ShortNo`(string)（参照真实 API 响应）
- **P1-10 SendMessageAsync WIP 注释**：说明 `/v1/message/send` 不存在，消息发送
  走 WuKongIM `chatManager.send`

P2 修复（6 个）：
- **P2-1 GetCurrentUserAsync WIP 注释**：说明 web 客户端不调用此端点
- **P2-2 GetChannelsAsync WIP 注释**：说明对话列表走 WuKongIM sync
- **P2-3 GetMessagesAsync WIP 注释**：说明消息历史走 WuKongIM sync
- **P2-4 stream_* 事件 WIP 注释**：说明 stream_start/stream_chunk/stream_end
  为虚构事件，真实流式通过 `Message.streamOn` + `streamFlag` 驱动
- **P2-5 UploadCredentials 私有类**：camelCase JSON 映射
  (`uploadUrl`/`downloadUrl`/`contentType`/`contentDisposition`)
- **P2-6 ChatViewModel 适配**：3 处 `UploadFileAsync` 调用添加 `channelType`
  参数，返回类型从 `Task<Message>` 适配为 `Task<string>`

涉及文件：`ApiService.cs`、`IApiService.cs`、`AuthService.cs`、`WebSocketService.cs`、
`IWebSocketService.cs`、`ServerConfigService.cs`、`UpdateService.cs`、
`IUpdateService.cs`、`ChatViewModel.cs`、`ServerConfigViewModel.cs`、
`Models/User.cs`、`Models/ServerInfo.cs`、`Models/Message.cs`、`Models/Channel.cs`

待优化：
- WuKongIM .NET 客户端实现（替换当前 WebSocketService scaffold）
- 频道列表和消息历史通过 WuKongIM sync API 获取
- 消息发送通过 WuKongIM `chatManager.send` 实现
- 流式回复通过 `Message.streamOn` + `streamFlag` 状态字段驱动渲染
- LoginPage.xaml UI 适配新增的登录场景（邮箱登录/注册/忘记密码/扫码登录 tab）

**第八轮**（扩展登录场景 + 修复 PR blocker，参照 `login_vm.tsx` 真实代码）：

参照 octo-web 的 `packages/dmworklogin/src/login_vm.tsx`，新增 5 种登录场景，
使 MAUI 客户端支持与 web 端对等的全部登录方式。同时修复 PR #578 上 OctoBoooot
指出的 2 个编译 blocker 和 1 个安全 minor。

PR blocker 修复（3 个）：
- **CS7036 编译错误**：`ChatViewModel.cs` 第 324/355 行 `UploadFileAsync` 调用
  缺少 `ChannelType` 参数 → 添加 `SelectedChannel.Type`
- **ParseServerInfo 安全校验**：`ServerConfigService.ParseServerInfo` 未应用
  `IsSafeAuthorizePath`/`SanitizeHttpUrl` → 调用 `ApiService` 的 `internal static`
  方法进行校验，同时添加 `legacy_password_login_off` 解析

新增登录场景（5 种）：
- **邮箱登录**：`POST /v1/user/emaillogin` — `{email, password, flag=2, device}`
- **用户名注册**：`POST /v1/user/usernameregister` — `{username, name, password, flag=2, device}`
- **邮箱注册**：`POST /v1/user/emailregister` + `POST /v1/user/email/sendcode`
  （code_type=0 注册）→ `{email, password, name, code, flag=2, device}`
- **忘记密码**：`POST /v1/user/email/forgetpwd` + `POST /v1/user/email/sendcode`
  （code_type=1 忘记密码）→ `{email, code, new_password}`
- **二维码扫码登录**：`GET /v1/user/loginuuid`（返回 `{uuid, qrcode}`）→
  轮询 `GET /v1/user/loginstatus?uuid=...`（状态机：waitScan→scanned→authed/expired）→
  `POST /v1/user/login_authcode/{authCode}` 换取 token

**第九轮**（代码质量优化，11 个问题）：

基于深度审阅发现的质量问题，进一步优化代码结构和健壮性：

**代码复用**：
- **P1-2 IsLoopback 提取**：`ApiService`、`ServerConfigService`、`WebSocketService` 中重复的 `IsLoopback` 方法提取到 `HttpUtils.cs` 静态类
- **P1-3 HttpClient 创建提取**：三个服务中重复的 `HttpClient` 创建逻辑（含 TLS 安全配置）提取到 `HttpUtils.CreateHttpClient()`

**异常处理**：
- **P0-1 LogoutAsync await**：`AuthService.LogoutAsync` 中 `SecureStorage.Remove` 改为 `await RemoveAsync`，确保 token 清理完成
- **P1-1 UpdateBaseUrl try-catch**：`ApiService.UpdateBaseUrl` 延迟释放 oldClient 添加 try-catch，防止 dispose 异常
- **P1-4 CheckForUpdatesAsync try-catch**：`App.xaml.cs` 中版本检查调用添加 try-catch
- **P2-4 Preferences.Set try-catch**：`ServerConfigService.SetServerUrlAsync` 中 `Preferences.Set` 添加 try-catch

**资源管理**：
- **P0-2 CTS Dispose**：`ChatViewModel._loadMessagesCts` 切换频道时先 Cancel 再 Dispose
- **P2-1 GetDevice 缓存**：`ApiService.GetDevice()` 使用 `Lazy<>` 缓存设备信息，避免重复创建

**代码健壮性**：
- **P1-5 SendAsync 真实用户 ID**：`ChatViewModel.SendAsync` 中 `FromUid`/`SenderName` 使用真实用户数据而非硬编码 `"me"`/`"我"`
- **P2-2 ViewModelBase nullable 注解**：`ViewModelBase.Get<T>` 方法添加返回值说明
- **P2-5 AddUploadedMessage 空值检查**：添加 `SelectedChannel` 空值检查

涉及文件：`ApiService.cs`、`HttpUtils.cs`（新建）、`ServerConfigService.cs`、`WebSocketService.cs`、
`AuthService.cs`、`ChatViewModel.cs`、`App.xaml.cs`、`ViewModelBase.cs`

**第十二轮**（硬编码清理）：

移除代码中所有硬编码的字符串和魔法数字，统一到常量类管理：

**新建常量类**：
- **ApiConstants.cs**：包含三个静态类
  - `ApiPaths`：所有 REST 端点路径（`/v1/user/login`、`/v1/common/appconfig` 等）
  - `ApiDefaults`：默认 BaseUrl 和设备类型常量（0=app, 1=web, 2=pc）
  - `PreferencesKeys`：所有 Preferences/SecureStorage 键名
- **MarkdownColors.cs**：MarkdownView 的亮色/暗色主题颜色方案

**更新文件**（替换硬编码）：
- `ApiService.cs`：所有 `/v1/*` 路径 → `ApiPaths.Xxx`，`flag=2` → `ApiDefaults.DeviceFlagPc`
- `WebSocketService.cs`：`/v1/users/{uid}/im` → `ApiPaths.UsersIm`
- `ServerConfigService.cs`：`/v1/common/appconfig` → `ApiPaths.CommonAppconfig`，偏好键名 → `PreferencesKeys.ServerUrl`
- `UpdateService.cs`：`/version.json` → `ApiPaths.VersionJson`
- `ApiOptions.cs`：默认 BaseUrl → `ApiDefaults.BaseUrl`
- `MauiProgram.cs`：fallback BaseUrl → `ApiDefaults.BaseUrl`
- `App.xaml.cs`：窗口持久化键 → `PreferencesKeys.WinX/Y/W/H`
- `AuthService.cs`：所有 Preferences 键 → `PreferencesKeys.Token/AuthUid/AuthName/AuthSex/AuthShortNo`
- `MarkdownView.cs`：所有 `Color.FromArgb("#XXXXXX")` → `MarkdownColors.Light/Dark.Xxx`

**收益**：
- API 契约和配置键的单一数据源
- 类型安全重构 — 一处修改，全局更新
- 常量上的文档注释说明含义
- 消除重复硬编码字符串导致的复制粘贴错误

涉及文件：`ApiConstants.cs`（新建）、`MarkdownColors.cs`（新建）、`ApiService.cs`、`WebSocketService.cs`、
`ServerConfigService.cs`、`UpdateService.cs`、`ApiOptions.cs`、`MauiProgram.cs`、`App.xaml.cs`、
`AuthService.cs`、`MarkdownView.cs`

## 许可

Apache License 2.0 — 与父仓库 `octo-web` 相同。
