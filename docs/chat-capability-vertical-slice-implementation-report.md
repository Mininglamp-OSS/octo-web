# Octo 聊天能力纵向拆分与 Client 集成实施报告

> 日期：2026-09-03  
> octo-web 分支：`feat/chat-capability-vertical-slice`  
> octo-buddy-client 分支：`feat/chat-capability-integration`

## 1. 报告结论

本次实现验证的不是若干互相竞争的集成方案，而是一条统一的能力演进路径：

```text
@octo/chat-core
        ↓
@octo/chat-react
        ↓
ConversationWindow / ConversationSurface
        ↓
ChatPage + ContactsList 组成的 CommunicationShell
        ↓
client-communication 独立构建产物
        ↓
octo-buddy-client WebContentsView 宿主
```

这条路径同时解决两个问题：

1. octo-web 内部可以逐步把聊天能力从页面代码中拆出，形成可组合的功能模块。
2. octo-buddy-client 可以继续使用自己的整体布局、登录入口和 Electron 能力，同时复用 octo-web 已有聊天与通讯录业务实现。

当前已经跑通完整纵向链路，包括 Client 侧的消息/通讯录入口、登录态注入、Space 同步、联系人发起会话、未读数、窗口生命周期、异常恢复、构建产物校验和生产打包。

需要明确的是：当前并没有完成 WKSDK 的彻底抽离。`legacyChatClient` 仍然是 `chat-core` 和 octo-web 既有聊天运行时之间的适配层，连接和断开操作暂时还是空实现，消息发送仍依赖已挂载的旧 `ConversationContext`。因此，当前成果是可用的功能边界和迁移骨架，不是已经完全独立的新聊天 SDK。

## 2. 实际提交

### 2.1 octo-web

| 提交 | 内容 |
| --- | --- |
| `9bdc986b` | 抽离聊天核心、React 生命周期层和业务 ConversationWindow |
| `62eaee2b` | 为嵌入式通信宿主补充布局与运行能力 |
| `1ce396c8` | 新增 Client 通信单入口和独立构建产物 |
| `65a6e2e0` | 加固首次导航、连接和嵌入生命周期，并修复会话视口高度链 |
| `a2b05d41` | 增加可由宿主传入频道的独立会话 presentation |

相对 `upstream/main` 共修改 51 个文件，新增约 6309 行，删除约 348 行。

### 2.2 octo-buddy-client

| 提交 | 内容 |
| --- | --- |
| `f615a99` | 在 Client 中嵌入 octo-web 消息和通讯录 |
| `8261073` | 将校验后的通信 renderer 加入打包流程 |
| `5f4bfb0` | 修复跨平台 after-pack 资源路径 |
| `c334476` | 加固 renderer 边界、生命周期、下载和版本锁定 |
| `e64c9f6` | 增加独立会话模拟入口和 presentation/target 宿主链路 |

相对 `origin/main` 共修改 31 个文件，新增约 2702 行，删除约 27 行。

## 3. 已实现能力

### 3.1 无框架聊天核心 `@octo/chat-core`

代码位置：

- `packages/chat-core/src/types.ts`
- `packages/chat-core/src/ManagedChatClient.ts`
- `packages/chat-core/src/ManagedChatClient.test.ts`

已经实现：

- SDK 无关的 `ChatClient` 接口。
- `start()`、`stop()`、`openConversation()`、`getSnapshot()` 和事件订阅。
- `ChatConnectionAdapter`、`ChatConversationAdapter`、`ChatSubscribeAdapter`、`ChatMessageAdapter` 四类适配接口。
- 通用消息端口：历史消息加载、消息订阅、发送状态订阅、发送消息。
- `ChatConversationLease` 会话租约，使用幂等 `release()` 管理释放。
- `start()` 和 `stop()` 幂等。
- 连接、会话切换和释放过程串行化。
- 并发打开会话采用 latest-request-wins。
- 连接 epoch 隔离，旧连接的迟到回调不能覆盖新连接状态。
- transport 主动报告断线和恢复。
- adapter 异常统一反映为 `failed` 状态。

这一层不依赖 React，也不直接依赖 `wukongimjssdk`，是后续真正下沉 SDK 生命周期的目标位置。

### 3.2 React 生命周期层 `@octo/chat-react`

代码位置：

- `packages/chat-react/src/ChatProvider.tsx`
- `packages/chat-react/src/ConversationWindow.tsx`
- `packages/chat-react/src/hooks.ts`

已经实现：

- `ChatProvider` 向组件树提供唯一 `ChatClient`。
- hooks 读取客户端、状态和宿主能力。
- 无 UI 假设的 `ConversationWindow` 生命周期边界。
- 组件挂载或 channel 改变时打开会话。
- 组件卸载、停用或切换 channel 时释放会话。
- 防止异步 `openConversation()` 迟到后污染新会话。
- 防止组件卸载后继续更新 React state。
- 支持 render function，调用方可以自行决定 UI。

这里的 `ConversationWindow` 是会话生命周期组件，不负责绘制完整聊天界面。

### 3.3 可独立组合的业务聊天窗口

代码位置：

- `packages/dmworkbase/src/Components/ConversationWindow/index.tsx`
- `packages/dmworkbase/src/Components/ConversationWindow/index.css`
- `packages/dmworkbase/src/Components/Conversation/index.tsx`

已经实现两个层次：

#### `ConversationSurface`

只包含会话内容区域，适合嵌入抽屉、ThreadPanel 或其他组合界面。

- 接收 `ChatClient` 和目标 `Channel`。
- 通过 `ChatProvider` 和 `chat-react` 管理会话租约。
- 复用原有消息列表、编辑器、附件、消息状态等业务 UI。
- 支持 `primary` 和 `auxiliary` 模式。
- 可绑定旧 `ConversationContext`，作为迁移期间的兼容入口。

#### `ConversationWindow`

在 `ConversationSurface` 外增加完整窗口结构：

- 会话标题和头像。
- 返回操作。
- 右侧业务操作区。
- 消息多选状态和取消操作。
- inactive 状态及辅助功能隔离。
- 错误边界。

原 `ChatPage` 已改为使用该窗口，`ThreadPanel` 也改为复用统一的 `ConversationSurface`。这证明它不是只为 Client 构造的旁路组件，而是已经开始由 octo-web 自身消费。

### 3.4 旧聊天运行时适配器

代码位置：

- `packages/dmworkbase/src/features/chat-capability/legacyChatClient.ts`

已经实现：

- 将 `ChatChannelRef` 转换为 WKSDK `Channel`。
- 将通用历史消息加载参数转换为 `SyncMessageOptions`。
- 将 WKSDK 消息监听映射为 `ChatMessagePort`。
- 将发送状态监听映射为通用消息状态订阅。
- 通过共享 runtime 保证页面内使用同一个 `ManagedChatClient`。
- 通过 `bindConversationContext()` 暂时复用原有消息发送能力。

当前限制：

- `connect()` 和 `disconnect()` 暂时没有接管 WKSDK 生命周期。
- `sendMessage()` 仍需要已挂载的旧 `ConversationContext`。
- 消息实体仍直接使用 WKSDK 的 `Message`、`MessageContent` 和 `SendackPacket`。

这部分是下一阶段真正 SDK 化的主要工作区。

### 3.5 消息与通讯录工作台入口

代码位置：

- `apps/web/src/client-communication/index.tsx`
- `apps/web/src/client-communication/CommunicationShell.tsx`
- `apps/web/src/client-communication/hostBridge.ts`

已经实现：

- 独立启动 octo-web 通信所需模块，不启动完整站点外壳。
- 从宿主获取登录信息、API Origin、Space、主题和语言。
- 使用 Client 已有登录态初始化 `WKApp.loginInfo`，没有再实现一套登录页面。
- 注册 Base、DataSource、Contacts、Summary 和企业模块。
- 同一 renderer 中组合 `ChatPage` 与 `ContactsList`。
- 在消息和通讯录之间切换，不销毁通信运行时。
- 通讯录卡片继续调用 octo-web 的 `WKApp.endpoints.showConversation()` 发起会话。
- 支持宿主直接打开指定 channel、定位消息或打开会话内搜索。
- 支持 `workspace` 和 `conversation` 两种 presentation：前者保留会话列表，后者只渲染指定聊天窗口。
- `conversation` presentation 接收宿主传入的 `channelId/channelType`，但继续使用现有登录态、Space、IM 连接、历史消息和发送能力。
- 将内部页面跳转回报给 Client，使 Client 左侧入口保持同步。
- 将当前打开的真实频道回报给 Client，便于宿主把用户刚选择的会话再次嵌入独立窗口。
- 将会话未读总数同步给 Client。
- 支持 `spaceChanged`、`appearanceChanged`、`suspend`、`resume` 和 `sessionRevoked`。
- command listener 和左右路由都准备完成后才上报 ready，避免首次目标会话丢失。

因此，通讯录点击卡片发起会话并不是 Client 重新实现的逻辑，而是继续复用 octo-web 已有通讯录和会话打开链路。

### 3.6 octo-web 单入口独立构建

代码位置：

- `apps/web/client-communication.html`
- `apps/web/vite.client-communication.config.ts`
- `apps/web/scripts/build-client-communication.mjs`

构建命令：

```bash
VITE_API_URL=<api-origin> pnpm --filter octo-web build:client-communication
```

输出目录：

```text
apps/web/build-client-communication/
├── index.html
├── assets/
└── renderer-manifest.json
```

manifest 包含：

- schema 版本。
- 产物名称。
- octo-web 版本。
- Git commit。
- HTML 入口。
- Host Bridge major 版本。
- 是否为 E2E mock 产物。

这不是复制整个 octo-web 站点，而是为通信工作台增加一个独立 Vite/Rollup 入口，共用原有源码、依赖和业务模块。

### 3.7 Client 布局融合

代码位置：

- `src/renderer/src/App.tsx`
- `src/renderer/src/communication/CommunicationViewSlot.tsx`

已经实现：

- Client 左侧增加“消息”和“通讯录”入口。
- Client 左侧增加“独立会话”模拟入口，可输入 `channelId` 和 `channelType`，也可复用最近选择的真实频道。
- 消息入口显示未读数，超过 99 显示 `99+`。
- Client 自己保留侧边栏和整体页面布局。
- 中央内容区域提供 `CommunicationViewSlot`。
- Slot 实时测量坐标和尺寸并同步给 Electron 主进程。
- 打开对话框等遮挡场景时隐藏通信 View。
- 加载、恢复和失败时显示 Client 自己的状态 UI。
- 失败后提供“重试”操作。
- octo-web 内部从联系人跳入聊天时，Client 的侧栏选中项也会同步变化。

### 3.8 Electron WebContentsView 宿主

代码位置：

- `electron/main/communication/view-manager.ts`
- `electron/main/communication/ipc.ts`
- `electron/main/communication/ipc-validation.ts`
- `electron/communication-preload/index.ts`

已经实现：

- 使用单个持久 `WebContentsView` 承载通信 renderer。
- 消息和通讯录切换复用同一个 View，不重复建立 IM 运行时。
- 根据 Client Slot 的 bounds 设置原生 View 位置。
- 通过独立 preload 暴露最小通信 Bridge。
- 主页面和子 renderer 的 IPC 分开校验。
- 只接受目标通信 entry 主 frame 发出的子 IPC。
- 不向网页暴露原始 Electron IPC event。
- ready 前命令排队，按类型合并过期命令。
- 支持首次加载时的并发导航和 Space 更新。
- Client 隐藏后忽略迟到的内部导航，避免抢回通信页面。
- 主窗口隐藏/恢复时发送 suspend/resume。
- 同账号 token 或 apiOrigin 更新时重载 renderer。
- 切换账号、退出登录、登录失效和应用退出时销毁通信运行时。
- renderer 无响应、崩溃或加载超时时进入失败/恢复流程。
- 自动恢复受次数限制，手动重试可以重新创建 View。

### 3.9 系统能力代理

通信 renderer 不直接获得 Node 或 Electron 权限。以下能力通过窄 Bridge 交给宿主：

- 打开外部链接。
- 下载文件并显示系统保存对话框。
- 系统通知及通知点击回传。
- 检查窗口焦点。
- 查询麦克风权限。

下载实现增加了：

- 仅允许 HTTPS，开发/E2E 场景可显式允许 HTTP。
- 拒绝 URL 中携带用户名和密码。
- 私网和本机地址限制。
- 重定向逐跳重新校验。
- 最多 5 次重定向。
- 5 分钟超时。
- 512 MB 大小限制。
- 流式写入，避免整文件进入内存。
- 失败时删除不完整文件。

### 3.10 产物打包和版本锁定

Client 代码位置：

- `scripts/prepare-communication-artifact.mjs`
- `resources/communication/expected-renderer.json`
- `electron/main/communication/artifact-validation.ts`
- `electron-builder.yml`

当前锁定产物：

```json
{
  "schemaVersion": 1,
  "name": "octo-web-client-communication",
  "version": "1.0.12",
  "commit": "a2b05d41",
  "hostBridgeMajor": 1
}
```

实际复制到 Client 的生产 manifest 中 `e2eMock` 为 `false`。

打包前会校验名称、schema、版本、commit、Bridge major 和入口路径。未找到外部产物时会直接失败，不再静默复用本地 ignored 目录中的旧 renderer。E2E mock 产物默认禁止进入生产包。

## 4. 关键运行链路

### 4.1 从 Client 打开消息

```text
用户点击 Client“消息”
  -> App 将 view 切换为 octo-chat
  -> CommunicationViewSlot 上报 page + bounds
  -> 主进程 CommunicationViewManager 创建或复用 WebContentsView
  -> renderer 通过 Bridge 获取 Client 登录态和 Space
  -> CommunicationShell 初始化 octo-web 模块
  -> ChatPage 渲染会话列表和 ConversationWindow
  -> renderer reportReady
  -> Client 状态切换为 ready
```

### 4.2 从通讯录发起会话

```text
用户点击 Client“通讯录”
  -> 同一个 WebContentsView 切换到 ContactsList
  -> 用户点击联系人或群组卡片
  -> octo-web 调用 WKApp.endpoints.showConversation(channel)
  -> 右侧路由打开 ChatPage 会话
  -> CommunicationShell 回报 page=chat
  -> Client 左侧自动选中“消息”
```

### 4.3 Client 主动打开独立会话

```text
Client communication:show({ page: chat, presentation: conversation, target })
  -> ready 前进入 pending command 队列
  -> 左右路由和 command listener 全部准备完成
  -> 执行 navigate
  -> openTarget(target)
  -> WKApp.endpoints.showConversation(channel, options)
  -> 隐藏会话列表和 splitter
  -> 现有 ConversationWindow 填满通信区域
```

切回“消息”时，Client 发送 `presentation: workspace`，同一个 WebContentsView 恢复会话列表加聊天窗口布局，不重建 IM 运行时。

### 4.4 Space 与登录生命周期

```text
Client Space 改变
  -> updateSpace
  -> spaceChanged command
  -> 更新 WKApp.shared.currentSpaceId
  -> 触发 octo-web space-changed 事件

同 UID token 更新
  -> 销毁旧 renderer
  -> 使用新 bootstrap 重建

切换账号/退出登录
  -> 销毁 View
  -> 清理独立 partition 存储
```

## 5. 验证结果

| 范围 | 结果 |
| --- | --- |
| `@octo/chat-core` | 52 tests passed |
| `@octo/chat-react` | 15 tests passed |
| `@octo/base` | 473 files / 4323 tests passed |
| octo-web 正式 build | 通过 |
| production communication build | 通过 |
| Client typecheck | 通过 |
| Client unit tests | 49 passed |
| Communication Electron E2E | 12 passed |
| production manifest | `1.0.12 / a2b05d41 / e2eMock:false` |

E2E 覆盖：

- 消息与通讯录复用一个 WebContentsView。
- 首次加载并发导航。
- 首次加载直接打开指定联系人会话。
- Client 传入 `channelId/channelType` 后以独立会话模式打开现有频道。
- 独立会话隐藏左侧列表、填满聊天区域并保留消息编辑器。
- 从独立会话切回消息后恢复 workspace 布局。
- 首载期间 Space 发生变化。
- 隐藏状态下忽略迟到导航。
- 未读数同步。
- 外部链接、下载和通知 Bridge。
- renderer 崩溃自动恢复及恢复限流。
- renderer 无响应后手动重试。
- 同账号 token 轮换后重载。

## 6. 如何本地复核

### 6.1 构建 octo-web 通信产物

```bash
cd /Users/will/Project/octo/octo-web-chat-capability-vertical-slice
VITE_API_URL=https://im.deepminer.com.cn pnpm --filter @octo/web build:client-communication
```

### 6.2 将产物准备到 Client

```bash
cd /Users/will/Project/octo/octo-buddy-client-chat-capability-integration
OCTOBUDDY_COMMUNICATION_SOURCE=/Users/will/Project/octo/octo-web-chat-capability-vertical-slice/apps/web/build-client-communication pnpm prepare:communication-artifact
```

### 6.3 验证 Client

```bash
pnpm typecheck
pnpm test:unit
pnpm test:e2e -- tests/e2e/communication.spec.ts
pnpm build
```

## 7. 合理性评估

### 7.1 为什么没有直接复制 Chat 页面源码到 Client

直接复制会同时复制 WKApp 全局状态、路由、模块注册、SDK 单例和大量隐式依赖。短期可能显示 UI，长期会形成两套聊天实现、两套修复分支和两条升级链路。

当前方案仍然复用 octo-web 的完整业务实现，但通过独立入口和版本化 Bridge 隔离宿主差异。Client 不需要理解每一种消息类型，也不需要重新实现编辑器、消息状态或通讯录业务。

### 7.2 为什么同时需要包和构建产物

它们不是两个方案：

- 包负责源码内部的能力分层与组合。
- 构建产物负责跨应用、跨 React 运行时和 Electron 安全边界交付。

octo-web 内部使用包级能力，Client 使用由同一能力链构建出的 artifact。这样只有一套业务实现。

### 7.3 为什么当前阶段仍保留 legacy adapter

一次性迁走 WKSDK 连接、数据源、消息模型、编辑器、插件和缓存风险过高。先引入稳定接口和功能边界，可以让旧实现继续工作，同时为每一项依赖提供明确迁移位置。

## 8. 当前未完成项

以下能力尚未达到最终目标：

1. WKSDK connect/disconnect 尚未进入 `chat-core` adapter。
2. 消息模型尚未转换为完全 SDK 无关的数据结构。
3. 发送消息仍通过旧 `ConversationContext` 桥接。
4. 当前仍是同一个 communication artifact 通过 presentation 切换工作台和独立会话，并非单独发布的 ConversationWindow artifact。
5. 主题暂时由 Client 固定传入浅色和中文，尚未连接 Client 的真实主题/语言设置。
6. host 和 renderer 的 Bridge 类型目前在两个仓库各维护一份，后续应生成或发布共享 contract 包。

## 9. 下一阶段建议

下一阶段不再新建第二套实现，应继续沿现有链路推进：

1. 将 WKSDK 连接、重连和断线回调迁入 `ChatConnectionAdapter`。
2. 将 `ConversationContext.sendMessage()` 依赖迁入 `ChatMessageAdapter`。
3. 为消息 DTO 建立 SDK 到 core model 的转换层。
4. 让更多 octo-web 原生入口直接消费统一 `ConversationWindow`。
5. 将 Bridge contracts 提取为可版本化共享包。
6. 在同一构建配置中增加可选 `conversation-window` 入口，但仍复用相同 core、React 层和业务窗口，不复制实现。

完成前三项以后，聊天窗口才真正具备脱离 octo-web 全局运行时、由任意 React 宿主直接组合的条件。
