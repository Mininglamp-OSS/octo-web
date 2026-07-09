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

### 窗口管理（Windows）

- 默认窗口 1180×760，最小 880×560
- 窗口位置和尺寸持久化（基于 `Preferences`）
- 动态标题栏显示当前服务端地址

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
    │   └── ChatPage             #   聊天主界面
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
    │   ├── ApiService           #   REST 客户端（可运行时切换 BaseUrl）
    │   ├── AuthService          #   会话管理（token 持久化 + OIDC 登录）
    │   ├── ServerConfigService  #   服务端地址管理 + ProbeAsync 探测
    │   ├── ServerHistoryService #   历史记录（JSON 存储，最多 5 条）
    │   ├── WebSocketService     #   实时消息
    │   └── ThemeService         #   主题切换
    ├── Resources/               # 样式、颜色、图标、启动屏
    │   ├── Colors.xaml          #   浅色色板 + 转换器
    │   ├── Colors.Dark.xaml     #   深色色板
    │   └── Styles.xaml          #   通用样式（PrimaryButton / GhostButton）
    └── Platforms/               # 各平台配置（Windows / Android / iOS / Mac）
```

## 架构

采用 MVVM 模式，手写 `ViewModelBase`（无外部 MVVM 工具包依赖，零隐藏魔法）：

- **Pages** 是纯 XAML + code-behind，通过 `BindingContext` 绑定到 ViewModel
- **ViewModels** 通过 `ViewModelBase` 实现 `INotifyPropertyChanged`，用字典存储
  属性值，`CreateCommand` 辅助创建命令
- **Services** 通过 `MauiProgram` 依赖注入容器注册，在构造函数中注入
- **Models** 对应 `octo-server` 的 REST 数据结构
- **三层路由**：未配置服务端 → 服务端配置页；已配置未登录 → 登录页；已登录 → 聊天页

### 关键设计：ProbeAsync（探测不保存）

`ServerConfigService.ProbeAsync(url)` 是引导式配置的核心：

- 临时切换 `ApiService` 的 BaseUrl 到候选地址
- 调用 `GetServerInfoAsync()` 获取服务端能力
- 在 `finally` 块中恢复原 URL
- **不触发 `ServerChanged` 事件**，用户留在配置页查看预览

这避免了"验证即保存即跳转"的问题——用户可以先确认服务端能力，再决定是否保存。

## 服务端 API 契约

客户端使用以下 `octo-server` 端点：

| 端点 | 方法 | 用途 |
|---|---|---|
| `/` | GET | Ping 连通性检查（任意 HTTP 响应即可） |
| `/user/login` | POST | 本地用户名密码登录 |
| `/user/current` | GET | 获取当前用户信息（需 token） |
| `/channel/list` | GET | 获取频道列表 |
| `/channel/{id}/messages` | GET | 获取频道消息历史 |
| `/channel/{id}/message/send` | POST | 发送消息 |
| `/v1/common/appconfig` | GET | 获取服务端配置（含 OIDC 提供商） |
| `/v1/user/thirdlogin/authcode` | GET | 获取 OIDC 一次性授权码 |
| `/v1/user/thirdlogin/authstatus` | GET | 轮询 OIDC 登录状态 |

## 开发状态

已完成：
- ✅ 引导式服务端配置（分步验证 + 能力预览 + 历史记录）
- ✅ 本地账号密码登录
- ✅ 企业 OIDC / SSO 登录（authcode 轮询）
- ✅ 聊天界面（消息列表 + 频道侧边栏 + WebSocket）
- ✅ 主题系统（浅色 / 深色 / 跟随系统）
- ✅ 窗口管理（位置持久化 + 最小尺寸限制）

待实现：
- ⬜ 流式回复渲染
- ⬜ 文件 / 图片上传
- ⬜ 系统托盘集成
- ⬜ 自动更新

## 许可

Apache License 2.0 — 与父仓库 `octo-web` 相同。
