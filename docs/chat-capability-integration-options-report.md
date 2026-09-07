# Octo Web 聊天能力接入 OctoBuddy Client 方案分析报告

> 报告日期：2026-09-03
> 目标：在不改变 octo-web 后端接口的前提下，让 OctoBuddy Client 能够按自身布局灵活使用现有聊天与通讯录能力。
> 当前结论：短期采用“单一 communication artifact + Host Bridge + 双 presentation”，长期继续推进 octo-web 内部聊天能力分层。

## 1. 执行摘要

本轮工作讨论过 5 种技术方向，其中 3 种已经通过代码、构建和自动化测试进行了实际验证。

| 方案 | 状态 | 结论 |
| --- | --- | --- |
| Client 重新实现聊天 UI | 完成分析，未实施 | 自由度高，但重复建设和长期维护成本最高，不建议采用 |
| 复制 octo-web 聊天源码到 Client 编译 | 完成分析，未实施 | 短期可能运行，依赖和升级风险不可控，不建议作为正式方案 |
| octo-web 单入口整体打包 | 已完成验证 | 能快速、完整复用消息和通讯录能力，是可靠的交付边界 |
| 聊天能力分层抽离 | 已完成第一阶段验证 | 是长期架构方向，但当前还没有彻底摆脱旧 WKSDK 运行时 |
| 独立会话 presentation | 已完成验证 | 满足 Client 传入频道并独立显示聊天窗口的目标，是当前最佳使用形态 |

推荐方案不是只选择其中一项，而是组合使用：

1. octo-web 内部使用 `chat-core`、`chat-react`、`ConversationSurface` 和 `ConversationWindow` 分层组织能力。
2. octo-web 对外仍发布一个经过版本校验的 communication artifact。
3. Client 通过稳定 Host Bridge 传入登录态、Space、布局模式和目标频道。
4. 同一个 renderer 支持 `workspace` 和 `conversation` 两种 presentation。
5. 消息、通讯录和独立聊天窗口共享一个 `WebContentsView` 和一套 IM 运行时。

该组合既保证当前能够交付，也为后续真正 SDK 化保留了清晰的演进路径。

## 2. 背景与目标

### 2.1 业务目标

Client 希望拥有自己的整体布局和导航，包括：

- 左侧放置“消息”“通讯录”“独立会话”等入口。
- 中央区域按 Client 的页面结构显示通信功能。
- 从通讯录点击联系人或群组后能够发起会话。
- 在某些业务页面中，只嵌入指定聊天窗口，不显示完整会话列表。
- Client 可以传入 `channelId` 和 `channelType`，直接打开已有频道。
- 继续使用 octo-web 已有登录态、Space、历史消息、编辑器、附件、发送状态和 IM 连接。

### 2.2 核心约束

本次方案必须遵守以下边界：

1. 不修改 octo-web 现有后端接口。
2. 不在 Client 中重新实现全部消息类型。
3. 不建立第二套聊天业务逻辑和修复分支。
4. 消息和通讯录切换不能重复初始化 IM 连接。
5. Client 必须保留自己的窗口、导航、弹窗和生命周期控制。
6. 最终产物能够随 Client 安装包发布，不依赖开发服务器和 octo-web 源码目录。

## 3. 评估维度

所有方案按以下维度统一评估：

- **业务完整度**：是否覆盖消息、历史记录、编辑器、附件、发送状态、通讯录和未读数。
- **布局灵活性**：是否能只显示聊天窗口，以及是否能嵌入 Client 的不同页面。
- **复用程度**：是否继续使用 octo-web 的现有业务实现和 IM 运行时。
- **初始成本**：首次实现和联调所需工作量。
- **长期成本**：octo-web 升级、新消息类型和缺陷修复时的同步成本。
- **运行风险**：登录态、SDK 单例、全局状态、样式和多连接问题。
- **交付独立性**：是否可以打包、版本锁定和离线随 Client 发布。
- **演进空间**：是否有利于未来形成可复用聊天 SDK 和功能模块。

## 4. 方案一：Client 重新实现聊天 UI

### 4.1 方案说明

Client 直接调用 octo-web 现有后端接口，自行实现会话列表、消息列表、编辑器、附件、消息状态和通讯录界面。

### 4.2 优点

- Client 对布局和交互拥有最高控制权。
- 不需要承载 octo-web 页面运行时。
- 理论上可以针对桌面端做更深度的性能和交互优化。

### 4.3 主要问题

- 后端接口并不等于完整聊天能力，仍需处理 WKSDK、连接、重连、缓存、消息确认和事件订阅。
- octo-web 已支持的文本、图片、文件、引用、卡片和其他消息类型都需要重新实现。
- 编辑器、附件上传、下载、通知、未读数和消息状态存在大量隐含行为。
- octo-web 后续新增能力时，Client 必须再次开发和测试。
- 最终会形成两套表现接近但行为可能不一致的聊天产品。

### 4.4 成本判断

| 项目 | 估算 |
| --- | --- |
| 首次实现 | 高，约 40-80 人日 |
| 完整联调与回归 | 高 |
| 长期维护 | 很高 |
| 适合场景 | 明确决定建设全新桌面聊天产品，并愿意长期维护独立团队 |

### 4.5 结论

技术上可以实现，但与“优雅复用现有资源”的目标相反，不建议采用。

## 5. 方案二：复制 octo-web 源码到 Client 编译

### 5.1 方案说明

将聊天相关源码、组件和依赖直接复制或软链接到 Client，在 Client 的 React 工程内完成编译。

### 5.2 优点

- 初期能够快速看到原有 UI。
- Client 可以直接修改被复制的组件。
- 不需要额外 renderer 进程或页面容器。

### 5.3 主要问题

- 聊天页面依赖 `WKApp`、模块注册、路由、Context、SDK 单例和全局样式，并非复制几个 React 组件即可运行。
- octo-web 与 Client 的 React、构建工具和依赖版本可能发生冲突。
- 源码复制后，缺陷修复和新功能无法自然同步。
- 为了让复制代码运行，通常需要不断复制更多依赖，边界会持续扩大。
- 最终产物虽然能运行，但来源、版本和维护责任难以管理。

### 5.4 成本判断

| 项目 | 估算 |
| --- | --- |
| 首次看到页面 | 中，约 5-10 人日 |
| 达到稳定可用 | 高，约 20-40 人日 |
| 长期维护 | 很高 |
| 适合场景 | 一次性演示或废弃周期明确的临时项目 |

### 5.5 结论

“不管过程、结果能跑”的短期目标有机会达到，但不能形成可持续的正式方案。本轮没有继续实施该方向。

## 6. 方案三：octo-web 单入口整体打包

### 6.1 方案说明

在 octo-web 中新增 `client-communication` 构建入口，仅启动聊天和通讯录需要的模块，然后输出独立静态 artifact。Client 使用 Electron `WebContentsView` 加载该产物。

运行边界如下：

```text
OctoBuddy Client
  -> CommunicationViewSlot
  -> Electron WebContentsView
  -> Host Bridge
  -> client-communication artifact
  -> ChatPage / ContactsList
  -> octo-web 现有运行时和后端接口
```

### 6.2 已验证能力

- 使用 Client 现有登录态初始化 octo-web 通信运行时。
- 使用 Client 当前 Space。
- 消息和通讯录共用一个 renderer。
- 通讯录点击联系人或群组后发起会话。
- 历史消息、编辑器、附件和消息发送继续使用现有实现。
- 未读数回传 Client。
- 支持外部链接、下载、通知和麦克风权限代理。
- 支持窗口隐藏、恢复、崩溃恢复、登录失效和 token 更新。
- artifact 可以版本锁定并随 Client 安装包发布。

### 6.3 优点

- 业务复用最完整，Client 不需要理解消息类型。
- octo-web 修复后重新构建 artifact 即可进入 Client。
- React 依赖和全局样式被隔离在独立 renderer 中。
- 可以对 artifact 名称、版本、commit 和 Bridge major 进行校验。

### 6.4 局限

- 最初只能以完整消息工作台形态使用，布局粒度不够细。
- artifact 体积较大，当前主 JS 约 9 MB、CSS 约 1 MB，仍有拆包空间。
- Host 与 renderer 之间需要维护稳定 Bridge 契约。

### 6.5 结论

这是当前最可靠的跨应用交付边界，已经完成验证，应继续保留。

## 7. 方案四：聊天能力分层抽离

### 7.1 方案说明

将聊天能力按职责分为三个层级：

```text
@octo/chat-core
  无 React、SDK 无关的生命周期和消息端口

@octo/chat-react
  React Provider、hooks 和会话租约管理

ConversationSurface / ConversationWindow
  可组合的完整业务聊天区域
```

### 7.2 当前完成情况

已经完成：

- `ManagedChatClient` 生命周期、状态、订阅和并发控制。
- `ChatProvider`、hooks 和 `ConversationWindow` 生命周期边界。
- `ConversationSurface` 与完整 `ConversationWindow`。
- octo-web 原有 `ChatPage` 和 `ThreadPanel` 开始复用新边界。
- 通过 legacy adapter 继续连接既有 WKSDK 和 `ConversationContext`。

尚未完成：

- WKSDK connect/disconnect 尚未完全进入 `chat-core` adapter。
- 消息实体仍包含 WKSDK 类型。
- 消息发送仍通过旧 `ConversationContext` 桥接。
- 尚未单独发布一个可供 Client 直接 import 的最小聊天 npm 包。

### 7.3 优点

- 从根本上明确聊天核心、React 生命周期和业务 UI 的职责。
- 支持聊天窗口、ThreadPanel、抽屉和其他组合场景。
- octo-web 自身也消费抽离后的能力，不会形成 Client 专用旁路。
- 为未来多宿主复用和真正 SDK 化提供基础。

### 7.4 局限

- 这是持续演进工程，不适合作为短期交付的唯一前置条件。
- 如果立即要求 Client 源码级 import，仍会遇到全局状态、SDK 和依赖版本问题。
- 完全独立需要继续迁移连接、消息模型、发送和缓存能力。

### 7.5 成本判断

| 阶段 | 估算 |
| --- | --- |
| 当前第一阶段能力边界 | 已完成并验证 |
| 完成 SDK 生命周期下沉 | 约 15-30 人日 |
| 形成稳定对外 npm 能力包 | 约 10-20 人日，另需兼容和发布治理 |
| 长期维护 | 低于复制或重写方案 |

### 7.6 结论

这是正确的长期架构方向，但不需要等待全部抽离完成后再交付 Client。

## 8. 方案五：独立会话 presentation

### 8.1 方案说明

在方案三的同一个 communication artifact 中增加布局模式，而不是再创建一套聊天应用：

- `workspace`：会话列表加聊天窗口，适合“消息”入口。
- `conversation`：隐藏会话列表和分隔条，只显示目标聊天窗口。

Client 发送：

```ts
{
  page: 'chat',
  presentation: 'conversation',
  target: {
    channelId: 'existing-channel-id',
    channelType: 1
  }
}
```

### 8.2 数据使用方式

Client 只负责告诉 octo-web“显示哪个频道”，并不传入消息数据。以下能力继续来自现有系统：

- Client 当前登录用户和 token。
- 当前 Space。
- WKSDK 连接和频道状态。
- 服务端历史消息。
- 新消息订阅。
- 消息类型渲染。
- 编辑器、附件和发送状态。

这意味着它使用的是现有真实数据，不是 Client 自己维护的一份模拟消息列表。

### 8.3 当前模拟入口

Client 已增加“独立会话”入口：

- 默认目标为 `botfather / 1`。
- 可以输入任意有效 `channelId/channelType`。
- 优先复用用户最近在消息或通讯录中打开的真实频道。
- 点击“加载”后更新目标，不重建整个通信运行时。
- 切回“消息”时恢复 `workspace` 布局。

### 8.4 优点

- 已满足“聊天窗口功能级独立”的实际需求。
- 不需要把聊天窗口打成第二份 artifact。
- 工作台和独立窗口共享登录态、连接、缓存和消息实现。
- Client 可以在自己的页面结构中决定聊天区域位置和尺寸。
- 后续可以继续增加 `thread`、`compact` 等 presentation，而不复制业务代码。

### 8.5 局限

- 当前仍由一个较完整的 renderer 承载，资源体积没有降到最小聊天组件级别。
- `channelId/channelType` 仍属于底层频道标识，后续可增加业务目标解析层。
- 主题和语言目前还没有完整连接 Client 设置。

### 8.6 结论

这是当前成本、稳定性和布局灵活性之间最均衡的方案，建议作为 Client 使用聊天能力的标准入口。

## 9. 综合对比

评分采用 1-5 分，5 分表示更优。

| 维度 | 重写 UI | 复制源码 | 整体 artifact | 能力分层 | 独立会话 presentation |
| --- | ---: | ---: | ---: | ---: | ---: |
| 业务完整度 | 2 | 3 | 5 | 4 | 5 |
| 布局灵活性 | 5 | 4 | 3 | 5 | 5 |
| 现有能力复用 | 1 | 3 | 5 | 5 | 5 |
| 初始交付效率 | 1 | 3 | 5 | 2 | 5 |
| 长期维护性 | 1 | 1 | 4 | 5 | 4 |
| 运行隔离性 | 4 | 1 | 5 | 3 | 5 |
| 版本可治理性 | 3 | 1 | 5 | 4 | 5 |
| 当前验证程度 | 1 | 1 | 5 | 4 | 5 |
| 综合建议 | 不推荐 | 不推荐 | 保留 | 长期推进 | 当前推荐 |

## 10. 实际验证结果

### 10.1 已完成的三阶段验证

#### 阶段一：整体通信能力进入 Client

- Client 左侧提供消息和通讯录入口。
- octo-web 输出单入口 artifact。
- Electron 使用单个持久 `WebContentsView` 承载。
- 登录态、Space、未读数、下载和通知通过 Host Bridge 协作。

#### 阶段二：聊天能力内部开始分层

- 新增 `chat-core` 和 `chat-react`。
- 新增可组合的 `ConversationSurface` 和 `ConversationWindow`。
- 原 `ChatPage` 和 `ThreadPanel` 开始消费新能力边界。

#### 阶段三：目标频道独立嵌入

- Host Bridge 增加 `presentation`。
- Client 可以传入 `channelId/channelType`。
- `conversation` 模式隐藏左侧会话列表。
- 聊天窗口填满可用区域并保留消息编辑器。
- 切回消息后恢复 `workspace` 模式。

### 10.2 自动化结果

| 验证项 | 结果 |
| --- | --- |
| `@octo/chat-core` | 54 tests passed |
| `@octo/chat-react` | 24 tests passed |
| `@octo/base` | 4325 tests passed |
| octo-web unit tests | 113 files / 1419 tests passed |
| octo-web production build | 通过 |
| communication artifact build | 通过 |
| Client typecheck | 通过 |
| Client unit tests | 49 passed |
| Communication Electron E2E | 12 passed |
| Client production build | 通过 |
| production artifact | 当前仅完成 provisional build；最终提交后需从 clean tree 重建并记录实际 commit |

### 10.3 核心 E2E 证据

自动化已经证明：

- 消息和通讯录复用一个 WebContentsView。
- Client 传入 `e2e-contact-bot / 1` 后，octo-web 打开对应已有频道。
- 独立会话模式下左侧列表和 splitter 被隐藏。
- 右侧聊天区域占满通信 viewport。
- 消息编辑器仍然存在。
- 切回消息入口后恢复 workspace 布局。
- 首次导航、Space 更新、隐藏状态、token 轮换和 renderer 恢复没有发生回归。

## 11. 推荐最佳实践

### 11.1 对外集成边界

Client 不直接 import octo-web 页面源码，而是加载经过校验的 communication artifact。

原因：

- 隔离 React 和依赖版本。
- 隔离全局样式和 WKApp 状态。
- 便于随安装包发布。
- 可以锁定版本和 commit。
- 可以独立处理 renderer 崩溃和恢复。

### 11.2 对内能力边界

octo-web 继续推进能力分层，并由 octo-web 自身消费这些模块。

原因：

- 避免抽出一套只服务 Client 的旁路实现。
- 逐步减少 legacy adapter 和全局 Context 依赖。
- 为未来真正发布聊天 SDK 或 npm 功能包做好准备。

### 11.3 布局控制边界

Client 负责：

- 左侧导航和页面组合。
- 通信区域的位置、尺寸和显隐。
- 选择 `workspace` 或 `conversation` presentation。
- 传入目标频道。

octo-web 负责：

- 会话业务状态。
- IM 连接和历史消息。
- 消息渲染和编辑器。
- 通讯录和发起会话。
- 未读数及内部导航事件。

### 11.4 运行时原则

- 一个 Client 窗口只维护一个 communication renderer。
- 消息、通讯录和独立会话只切换 page/presentation，不创建第二套 IM 运行时。
- Host Bridge 只传递必要状态和命令，不暴露任意 Electron IPC。
- artifact 必须通过 manifest 校验后才能进入生产构建。

## 12. 后续工作建议

### 12.1 近期产品化，预计 8-15 人日

1. 将主题和语言接入 Client 真实设置。
2. 增加频道不存在、无权限和已删除时的明确状态页。
3. 增加独立会话加载、失败和切换过程的埋点。
4. 使用真实账号完成文本、图片、文件、引用和卡片消息验收矩阵。
5. 将 Host Bridge contract 生成为两个仓库共享的版本化类型包。
6. 补充 Windows 和 macOS 安装包验证。

### 12.2 中期能力演进，预计 20-40 人日

1. 将 WKSDK connect/disconnect 和重连生命周期迁入 `ChatConnectionAdapter`。
2. 将发送能力从旧 `ConversationContext` 迁入 `ChatMessageAdapter`。
3. 建立 SDK 无关的消息 DTO，逐步隔离 WKSDK 类型。
4. 对 communication artifact 做路由级拆包和懒加载。
5. 根据实际业务增加 `compact`、`thread` 或只读 presentation。

### 12.3 暂不建议投入

- 不建议在 Client 中重写完整聊天 UI。
- 不建议复制 octo-web 源码形成第二套代码。
- 不建议为了形式上的组件独立，立即拆出第二个聊天 artifact。
- 不建议同时运行多个 communication renderer 来分别承载消息和通讯录。

## 13. 风险与控制措施

| 风险 | 影响 | 当前控制措施 | 后续措施 |
| --- | --- | --- | --- |
| artifact 与 Client 契约不兼容 | 页面无法启动 | 校验 schema、版本、commit 和 Bridge major | 发布共享 contract 包 |
| 测试 mock 产物进入生产 | 使用假数据或错误接口 | 默认拒绝 `e2eMock:true` | CI 增加 manifest gate |
| 多 renderer 导致多 IM 连接 | 重复消息和资源浪费 | 单 WebContentsView 复用 | 增加连接数量监控 |
| token 或账号切换污染旧状态 | 数据越权 | token 更新重载，退出时销毁并清理 partition | 增加账号切换 E2E |
| legacy adapter 继续扩大 | 抽离停滞 | 已建立 core/react/window 边界 | 按连接、发送、消息模型逐项迁移 |
| artifact 体积较大 | 首载性能受影响 | 独立构建入口 | 路由拆包、按需加载模块 |

## 14. 最终结论

从当前验证结果看，最合理的路线不是在 Client 中重写聊天，也不是复制 octo-web 源码，而是：

> 以 octo-web 为唯一聊天业务实现，通过单一 communication artifact 向 Client 交付；Client 使用稳定 Host Bridge 控制页面、presentation、目标频道和布局；octo-web 内部持续把聊天能力分层为 core、React 生命周期和业务窗口。

该方案已经证明能够：

- 使用现有真实数据和后端接口。
- 与 Client 现有登录和布局融合。
- 同时支持消息、通讯录和独立聊天窗口。
- 避免 Client 理解大量消息类型。
- 保持单一 IM 运行时。
- 随 Client 安装包稳定交付。
- 为未来更彻底的功能模块化和 SDK 化保留路径。

因此建议将“单 artifact + 双 presentation + 能力分层”确定为当前最佳实践，并以此作为后续产品化和架构演进的统一基线。

## 附录：关键提交

### octo-web

| Commit | 内容 |
| --- | --- |
| `8b3dc19d` | 抽离聊天核心、React 生命周期和可复用聊天窗口 |
| `0bc116b3` | 支持嵌入式通信宿主 |
| `606e3674` | 新增 communication renderer 单入口构建 |
| `8ae4359f` | 加固嵌入生命周期 |
| `c2b4e254` | 修复聊天 viewport 高度链 |
| `f3ccbc8a` | 补充能力集成验证手册 |
| `22a54d17` | 支持独立会话 presentation |
| `bd04b3e2` | 补充独立会话集成设计与实施说明 |
| `HEAD`（本提交） | 加固聊天生命周期、错误恢复和通信上报 |

### octo-buddy-client

| Commit | 内容 |
| --- | --- |
| `f615a99` | 嵌入 octo-web 消息和通讯录 |
| `8261073` | 将校验后的 renderer 加入打包流程 |
| `5f4bfb0` | 支持跨平台 after-pack 资源路径 |
| `c334476` | 加固 renderer 安全边界和生命周期 |
| `3804917` | 修复聊天区域 viewport |
| `e64c9f6` | 增加独立会话模拟入口 |
