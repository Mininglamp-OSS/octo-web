# Summary 与 Apps Artifact 实施报告

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 状态 | 评审问题已修复且本地回归通过；本次提交纳入 Web 修复，Client 与生产产物待对齐 |
| 日期 | 2026-09-08 |
| Web worktree | `/Users/will/Project/octo/octo-web-summary-apps-artifacts` |
| Web 分支 | `feat/summary-apps-artifacts` |
| Client worktree | `/Users/will/Project/octo/octo-buddy-client-chat-capability-integration` |
| Client 分支 | `feat/chat-capability-integration` |
| Client 基线策略 | 固定现有 worktree，不 merge/rebase 当前 `main` |
| API 地址 | `https://im.deepminer.com.cn/` |

## 2. 实施目标

在不修改后端接口、不改变 octo-web 原有功能的前提下，将以下能力交付为可独立加载的 renderer artifact：

- Communication：消息、通讯录、聊天窗口及唯一 IM runtime。
- Summary：智能总结完整工作区、红点和总结消息协作能力。
- Apps：应用列表、搜索、申请应用及发起机器人会话。

Client 保留自己的窗口和侧栏布局，通过三个受限 `WebContentsView` 加载 Web 产物。Summary 和 Apps 不创建 IM 连接，需要聊天能力时统一转交 Communication。

## 3. 最终架构

```text
octo-buddy-client
├── React host shell
│   ├── 消息 / 通讯录
│   ├── 智能总结
│   └── 应用
├── Electron main
│   ├── CommunicationViewManager
│   ├── EmbeddedFeatureViewManager(summary)
│   ├── EmbeddedFeatureViewManager(apps)
│   └── feature IPC router
└── WebContentsView
    ├── communication artifact  <- 唯一 WKSDK/IM runtime
    ├── summary artifact        <- HTTP + Summary UI
    └── apps artifact           <- HTTP + Apps UI
```

跨模块打开会话的调用链：

```text
Summary/Apps renderer
  -> child preload
  -> validated Electron IPC
  -> Client host navigation
  -> existing CommunicationViewManager
  -> communication renderer navigate command
  -> existing chat window
```

## 4. octo-web 实现

### 4.1 Summary 功能分层

保留原 `SummaryModule` 作为 Web 兼容组合入口，同时提供可按宿主组合的基础能力：

- `registerSummaryFoundation()`：注册 Summary 基础服务和页面依赖。
- `SummaryWorkspace`：受控路由工作区，可独立渲染列表、创建、详情、分享、确认和定时任务。
- `SummaryMessagingPort`：收口打开会话、读取群成员、总结完成通知和转发选择。
- Summary attention runtime：与 UI 分离，可由 artifact 独立启动并根据宿主窗口可见性暂停或恢复。
- legacy messaging adapter：Web 原入口继续使用 WKApp/WKSDK，行为保持兼容。

Communication artifact 只保留聊天内需要的 Summary 扩展和消息能力，不再承担 Summary 顶层工作区。

### 4.2 Apps Host Adapter

Apps 工作区通过 Host 能力完成会话跳转：

- 应用查询、搜索和申请仍调用原后端接口。
- 申请成功后构造 `ConversationTarget`。
- Web legacy host 继续使用原路由。
- Client artifact host 将 target 发送给 Communication。
- 机器人信息支持 `displayName`、`avatar` 和 `metadata`。
- 写入 IM ChannelInfo 时合并已有 `orgData`，避免覆盖机器人命令、在线状态等缓存字段。

### 4.3 独立构建入口

新增三套稳定构建：

```bash
pnpm --dir apps/web run build:client-communication
pnpm --dir apps/web run build:client-summary
pnpm --dir apps/web run build:client-apps
```

输出目录：

```text
apps/web/build-client-communication/
apps/web/build-client-summary/
apps/web/build-client-apps/
```

每个目录包含 `index.html`、静态资源和 `renderer-manifest.json`。manifest 锁定：

- `schemaVersion`
- `name`
- `featureId`
- `version`
- `commit`
- `hostBridgeMajor`
- `contractRevision`
- `sourceDirty`
- `e2eMock`
- `mockFlags`

默认禁止从 dirty worktree 构建。仅本地 E2E 可以显式设置：

```bash
OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1
```

### 4.4 Web 兼容性

原 Web 入口仍使用原有模块组合，未改变：

- `/summary`、`/appbot` 路由。
- Summary/AppBot 菜单。
- 后端请求路径和请求结构。
- 聊天窗口中的总结入口。
- 原 Web 登录和 Space 生命周期。

Artifact 专用 Bridge 和 E2E mock 只在独立入口执行，不进入 Web 默认启动路径。

## 5. Client 实现

### 5.1 独立宿主

Summary 与 Apps 分别使用独立 preload、partition 和 `WebContentsView`。公共 `EmbeddedFeatureViewManager` 提供：

- 懒创建、显示、隐藏和 bounds 同步。
- ready 超时。
- 状态上报。
- 一次自动崩溃恢复和手动重试。
- Space、外观、宿主窗口可见性和会话失效命令。
- 销毁时清理独立 partition 的存储与缓存。

Communication 保持独立 manager，以控制改动范围，并继续作为唯一 IM runtime。

### 5.2 Client UI

侧栏增加并统一管理：

```text
消息
通讯录
智能总结
应用
```

`FeatureViewSlot` 负责：

- 根据真实 DOM 矩形同步 View bounds。
- 页面切换时隐藏 View。
- 宿主弹窗遮挡期间隐藏 View。
- 显示 loading、recovering、failed 状态。
- 提供手动重试。

Summary badge 按 Space 隔离；Space 切换时先清零，再由新 Space 的 Summary runtime 上报。

### 5.3 跨 Artifact 协作

- Apps 点击机器人后切换到消息入口并打开目标会话。
- Summary 可以打开来源会话、读取会话成员、发送总结完成通知和请求转发。
- Summary 转发取消会立即返回 `null`，不会留下十分钟悬挂请求。
- Communication View 保持原实例，跨模块跳转不会重建 IM runtime。
- Client 接收 Communication 导航回报时保留已有机器人 metadata。
- Communication 中的总结卡片通过受限 IPC 打开 Summary 详情或分享预览，
  不依赖完整 Web 的顶层菜单路由；旧消息的 `task_no` 仍可使用。
- Summary 切换 Space 时重建工作区，清除详情、草稿、成员选择和旧 attention 读取；
  旧工作区的路由、红点及聊天动作回调失效。
- 独立详情的添加成员使用 `SummaryMessagingPort` 加载候选，
  仍调用原 `POST /summaries/:id/members`；默认 Web 继续使用原成员路由。

## 6. 安全与发布保护

已实现以下边界：

- Renderer 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Apps partition 拒绝全部 Electron permission；Summary 只允许当前可信主 frame
  发起纯音频请求，其他 frame、摄像头及未知权限仍拒绝。macOS 系统授权返回后
  再校验 View、入口 URL 和生命周期，退出登录后不得恢复旧授权。
- child IPC 校验 sender、mainFrame 和精确 artifact entry URL。
- IPC payload 进行运行时校验。
- artifact entry 必须是根目录下真实存在的顶层文件。
- Client 精确校验 manifest 与 `expected-renderer.json`。
- 生产环境拒绝 `e2eMock`、mock flags 和 dirty artifact。
- E2E dirty artifact 仅在 `E2E_TEST` 和显式 allow flag 同时存在时允许加载。
- Token 只通过 preload bootstrap 返回，不放入 URL/query。
- 外部导航被阻止，仅允许通过系统浏览器打开安全的 HTTP/HTTPS URL。
- Communication 的 `contractRevision` 为 `3`，Summary 为 `2`，Apps 为 `1`。
  旧协议产物会被拒绝，避免静默混用缺少卡片导航或 Space 作用域的 Bridge。

## 7. E2E Mock 策略

普通 Web E2E 使用 MSW Service Worker。Artifact 通过 `file://` 加载，MSW 会自动使用 Fetch/XHR interceptor fallback。

Artifact 启动逻辑会：

1. 等待 `worker.start()` 完成。
2. HTTP/HTTPS 页面等待 Service Worker controller。
3. `file://` 页面跳过无意义的 Service Worker controller 等待。
4. 两种模式都发送专用探针并验证响应标记。
5. 只有确认请求已被拦截后才设置 `window.__MSW_READY__ = true`。

Client E2E 的登录态及启动器固定使用保留域名 `octobuddy.e2e.invalid`，
避免遗漏的 mock 请求访问线上。探针仅证明拦截机制就绪，不证明每条业务请求都有 handler。
`file://` 使用 interceptor fallback，不等待不存在的 Service Worker controller。

## 8. 验证结果

下表保留拆分初版的验证记录，不代表 2026-09-07 修复后的所有产物已重新发布。
本轮逐项结果见 [Artifact Review Fixes](./summary-apps-artifact-review-fixes.md)。

| 验证项 | 结果 |
| --- | --- |
| Web 全量测试 | 通过 |
| `@dmwork/summary` 测试 | 959/959 |
| `@dmwork/appbot` 测试 | 23/23 |
| `@octo/chat-core` 测试 | 57/57 |
| `@octo/chat-react` 测试 | 24/24 |
| i18n 检查 | 通过 |
| Web production build | 通过 |
| 三套 production artifact build | 通过 |
| Client unit | 67/67 |
| Client typecheck | 通过 |
| Client build | 通过 |
| Artifact 集成 E2E | 7/7 |
| 两仓 `git diff --check` | 通过 |

Artifact E2E 覆盖：

- Summary/Apps 独立懒加载和互斥显示。
- rollback flag 隐藏入口并禁止加载。
- Session、Space、主题和语言共享。
- URL 不包含 token。
- Apps/Summary 发起聊天并复用同一 Communication View。
- Summary badge 按 Space 清零。
- renderer 一次自动恢复、第二次失败、手动重试。
- 账号切换和 Session 失效销毁全部 View。

已知基线问题：

- `pnpm --filter @dmwork/summary typecheck` 会因仓库现有 React 类型版本和 Semi 源码类型问题失败，错误广泛存在于第三方依赖和未修改文件。本次修改涉及的生产构建、测试及 Client 类型检查均通过；该基线问题应单独治理，避免混入 Artifact PR。

## 9. 本地验证命令

### Web

```bash
cd /Users/will/Project/octo/octo-web-summary-apps-artifacts
pnpm --filter @dmwork/summary test
pnpm --filter @dmwork/appbot test
pnpm --filter @octo/chat-core test
pnpm --filter @octo/chat-react test
pnpm i18n:check
pnpm --filter @octo/web test
pnpm --filter @octo/web build
```

### Production Artifact

必须在 clean Web commit 上构建：

```bash
VITE_API_URL=https://im.deepminer.com.cn/ VITE_E2E_MOCK=0 VITE_E2E_MOCK_IM=0 \
  pnpm --dir apps/web run build:client-communication
VITE_API_URL=https://im.deepminer.com.cn/ VITE_E2E_MOCK=0 VITE_E2E_MOCK_IM=0 \
  pnpm --dir apps/web run build:client-summary
VITE_API_URL=https://im.deepminer.com.cn/ VITE_E2E_MOCK=0 VITE_E2E_MOCK_IM=0 \
  pnpm --dir apps/web run build:client-apps
```

确认三个 manifest 均满足：

```json
{
  "sourceDirty": false,
  "e2eMock": false,
  "mockFlags": { "api": "0", "im": "0" }
}
```

### Client

```bash
cd /Users/will/Project/octo/octo-buddy-client-chat-capability-integration
pnpm test:unit
pnpm typecheck
pnpm run e2e:prepare
pnpm exec playwright test tests/e2e/embedded-features.spec.ts
```

## 10. 提交与集成顺序

1. 提交 Web 当前实现，得到真实 commit SHA。
2. 在 clean Web commit 上重新构建三套 production artifact。
3. 更新 Client 三份 `expected-renderer.json` 的 `commit`。
4. 将 production artifact 复制到 Client resources。
5. 再跑 Client unit、typecheck、build 和 Artifact E2E。
6. Client 继续保留在冻结 worktree；未经确认不提交，也不与当前 `main` 合并。
7. 最新 Client `main` 的适配在独立 worktree 和独立 PR 中处理。

2026-09-07 的验证未执行上述提交与生产产物更新。2026-09-08 本次提交仅纳入
Web 源码、测试与文档，不包含 Client 修改或生成产物。当前 resources 内的旧 Communication /
Summary 产物与当前宿主协议不兼容；本地回归使用隔离目录中的 E2E 产物，
不能把测试产物当作生产资源提交。

## 11. 回滚

- 通过 `OCTOBUDDY_SUMMARY_ARTIFACT_ENABLED=0` 单独关闭 Summary。
- 通过 `OCTOBUDDY_APPS_ARTIFACT_ENABLED=0` 单独关闭 Apps。
- 回退对应 `expected-renderer.json` 即可锁回上一版产物。
- Communication 与 Web 原入口不依赖 Summary/Apps artifact，可以独立保留。
