# W1: Web Core 常驻能力实施记录

日期：2026-09-13。
状态：W1a/W1b 已完成本批实现、全量回归和最终独立 review。
W2/C1 尚未接入，桌面后台能力未启用。

## 本轮结论

在新的 Web 分支 `feat/background-runtime-core` 开发；Client 已从
`fb2919b85dc1753cc3dca37b0834e3384bc58c89` 新建
`feat/background-runtime-host`，独立的 S1 设置修复已实现，详见该 worktree 的
`docs/desktop-settings-s1.md`。本次重新 fetch 后两端远端主干均未变化。

- 消息有效未读的算法、快照读取和共享订阅已放到 Web 共享层，旧导出保持兼容。
- 普通 Web/Electron 入口和通信模块已复用共享订阅；通信模块现在也能响应仅频道信息变化的更新。
- ChatVM 中同步、置顶、组织映射预填、会话过滤、预览和实时维护已提取到共享
  conversation store；ChatVM 保留呈现、选择、滚动与导航。
- 总结 attention 已有独立 runtime 入口、可注入的事件宿主和调度器。
  同一 JS realm 只允许一个活动 controller；保留原浏览器 leader 和轮询规则。
- 登录、组织、API 地址增加失效代次；Web 组织切换与通信页使用同一提交入口。
  不改变登录流程、路由布局、已读策略或 Client artifact pin。

**这不是“未打开消息/总结就有角标”的完整交付。**
当前桌面通信订阅仍由原页面启动，但数据 store 已可独立持有并处理同步与实时
更新。W2/C1 负责登录后的启动与宿主桥接。本轮不启动第二个 IM 连接，也不
提前挂载所有页面。

W1 is split into two reviewable steps:

- W1a: shared unread observation, conversation snapshot preparation,
  summary host/scheduler adapters, and compatibility tests.
- W1b: guarded sync ownership and realtime data listeners outside ChatVM.
  The installed SDK commits sync responses before the caller's `await` resumes;
  moving the existing post-await Space check alone cannot make that path safe.
  Keep desktop activation disabled until W1b and W2 are verified.

## Baseline And Scope

- Base: `Mininglamp-OSS/octo-web:main`, `03b64e2cc53b69e6c1e7e24e315f3a329dba0bfe`.
- Development branch: `feat/background-runtime-core`.
- Preserve browser, legacy desktop and current artifact behavior.
- Keep SDK connection creation, Electron IPC, artifact negotiation and lazy UI
  activation for W2/C1; move conversation data ownership in W1b.
- Do not modify notification preferences, account settings, voice consent or UI.

## Behavior List

- Existing message unread totals retain mute, Space, thread and system-message
  semantics.
- Message unread consumers can read a snapshot and subscribe without mounting a
  React page.
- Shared observation must not duplicate listeners and must clean up on stop.
- Conversation snapshot preparation retains pinned threads, Space mappings,
  filtering. W1a preserved the old commit behavior; W1b now guards provider
  conversion and SDK commit against stale context, ownership and realtime data.
- Summary attention initialization accepts explicit host visibility, scheduling
  and event adapters while preserving its existing browser defaults.
- Existing summary polling, freshness ordering, cross-tab leadership and
  compatibility paths keep their behavior.
- No second IM connection or second summary provider is started by this batch.

## File Map

- `packages/dmworkbase/src/im-runtime/`: shared unread selection/observation and
  conversation synchronization helpers with focused tests.
- `packages/dmworkbase/src/Pages/Chat/vm.ts`: subscribe to shared data operations;
  preserve presentation and navigation.
- `packages/dmworkbase/src/index.tsx`: publish the shared capability.
- `apps/web/src/App/electronUnreadCount.ts`: retain the legacy export as a
  compatibility delegate.
- `apps/web/src/App/index.tsx` and
  `apps/web/src/client-communication/CommunicationShell.tsx`: consume shared
  observation without changing their activation lifecycle yet.
- `packages/dmworksummary/src/runtime/`: injectable attention host adapter and
  independent public runtime entry.
- `packages/dmworksummary/src/utils/summaryAttentionSync.ts` and
  `summaryAttentionLeader.ts`: optional scheduler ports and exception-safe
  ordering before acquiring broadcast resources.
- `packages/dmworksummary/package.json`: expose the runtime subpath.
- Existing unread, ChatVM, summary runtime and datasource tests: regression
  coverage at the actual callers.

## PR Scope

This batch extracts shared capabilities, moves their data lifecycle outside
ChatVM and verifies existing consumers.
It does not claim that Client badges work before module activation yet.

The highest-risk change is moving conversation synchronization across a shared
boundary. Characterization tests must precede that change. If this portion
needs a separate reviewable commit, keep it distinct from unread observation.
Do not reduce test expectations merely to accommodate a refactor.

## Verification Plan

- Run the existing unread count tests before and after moving the selector.
- Add tests for initial snapshots, channel-info-only changes, listener cleanup,
  repeated startup and observer isolation.
- Run ChatVM channel-listener/sorting tests and datasource conversation tests
  before and after extracting sync operations.
- Cover stale requests, same-Space refresh overlap, pinned threads and legacy
  provider behavior for any modified synchronization path.
- Run summary runtime/attention tests with default browser adapters and an
  injected host, including cleanup, visibility and scheduler ownership.
- Run the relevant package tests and production communication/summary builds.
- Record actual commands/results below. Independent subagent review is
  required before commit; no commit or push is part of the initial setup.

## Progress

- [x] Fetch upstream and create an isolated Web worktree.
- [x] Create a separate Client worktree for the dependent host integration.
- [x] Record behavior, file ownership, PR scope and verification plan.
- [x] Establish regression baselines.
- [x] Extract shared unread observation and conversation snapshot preparation.
- [x] Extract the summary runtime host and scheduler adapter.
- [x] Finish guarded sync ownership and realtime listener migration (W1b).
- [x] Finish final regression checks and production builds.
- [x] Complete independent review and address findings.

## W1a Verification Results

| 检查 | 结果 |
| --- | --- |
| 原未读/通信页基线 | 改动前 30 项通过 |
| 原 ChatVM 基线 | 改动前 27 项通过；数据提取前再加入 4 项 characterization tests，31 项通过 |
| `packages/dmworkbase` 全量 | 490 文件、4829 项通过；之后补充异常清理和重入测试，最新相关 6 文件、71 项通过 |
| `packages/dmworkdatasource` 全量 | 12 文件、70 项通过，代码未修改 |
| `apps/web` 全量 | 最终代码单 worker 复跑：138 文件、1615 项通过；含真实 observer 的通信组件联动用例 |
| `packages/dmworksummary` 全量 | 最终代码 85 文件、1337 项通过；其中新增 runtime 测试 22 项 |
| 通信、总结生产入口编译 | 均通过 |
| `apps/web` TypeScript 检查 | 未通过；与同源码树基线均为 2666 条诊断，去除行列偏移后逐诊断比较无新增 |
| `git diff --check` | 通过 |
| 独立 subagent review | 完成；两项 P2 修复后复核通过，未发现新增可复现问题 |

构建使用 `OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1`、
`VITE_API_URL=https://runtime-build.invalid`，仅做本地编译验证。
两份 manifest 均为 `sourceDirty=true`、`e2eMock=false`；
保留 communication revision 3、summary revision 2。
这不是发布包，未更新 Client pin，未用于真实账号联调。

一次并行执行多个包的最终复跑中，`client-apps/noImStartup.test.ts`
首例超过默认 5000ms，后续一例也失败。当前树与同代码树基线分别单独执行该文件
均为 2/2 通过（约 4.4-4.5 秒）；保持原超时和断言、改用单 worker 后 Web
全量通过，新增通信联动测试后再次全量 1615 项通过。没有修改这组入口测试或应用入口代码。CI 仍需留意该冷导入用例的
运行时间余量，不能把一次本地重跑当作并行稳定性证明。

复核命令：

```bash
pnpm --dir packages/dmworkbase exec vitest run --maxWorkers=2 --silent
pnpm --dir packages/dmworkdatasource exec vitest run --maxWorkers=2 --silent
pnpm --dir apps/web exec vitest run --maxWorkers=2 --silent
pnpm --dir apps/web exec vitest run --maxWorkers=1 --silent
pnpm --dir packages/dmworksummary exec vitest run --maxWorkers=2 --silent
pnpm --dir apps/web exec tsc --noEmit --pretty false --incremental false
```

## W1a 独立评审记录

评审发现并修复：

1. 未读订阅回调重入时，旧发布轮次可能把新计数覆盖回旧值。新增发布代次判断，
   在新轮次出现后停止旧轮次。回归测试验证第二位订阅者收到 `[3, 0]`，
   不再出现 `[3, 0, 5]`。
2. 总结 leader 构造时，首次读取宿主可见性抛错可能遗留已打开的广播通道。
   将可能失败的首次读取移到资源创建前。回归测试覆盖失败、重试、正常销毁。

两项测试均先验证修复前失败，再验证修复后通过。独立 reviewer 另用不落盘探针
检查多层重入，以及原生 BroadcastChannel 的异常清理；复核未发现新增可复现问题。
新增通信组件用例直接使用共享 observer，覆盖 StrictMode、bridge 替换、
初始/后续快照和卸载清理。

评审基线：`03b64e2cc53b69e6c1e7e24e315f3a329dba0bfe`。
最终 25 个已改源码/测试/包配置文件（不含本文）的 SHA-256 指纹：
`8ed0b7bae18717d99d2828f920162185afb41ad8336c25b91943998326d67308`。
计算方式为路径去重排序后，逐项拼接 `path + NUL + file bytes + NUL`。
后续 W1b 改动需重新测试和 review，不能沿用本次结论。

## W1b 实施范围

### W1b 第一批：同步提交保护（已实现）

- 行为清单：保留现有页面启动时机、未读口径和置顶/预览行为；
  过期会话请求不得回写 SDK、组织映射或页面列表，同组织后发请求优先。
  此批不启用桌面常驻，也不宣称实时监听已从 ChatVM 迁出。
- 文件地图：`im-runtime/conversationSyncContext.ts` 记录上下文失效代次；
  `currentConversationSync.ts` 统一 provider 请求和 SDK 缓存提交；
  `App.tsx` 的身份/组织字段及 `APIClient.ts` 的 API 地址更新撤销旧提交权限；
  datasource callback 在转换/写缓存前校验；ChatVM 和标题恢复接入共享入口。
- PR 范围：W1b 同步竞态保护的独立可审查步骤。保留 W1a，暂不改
  notification、reminder 生命周期、全局 UI、实时监听和 Client pin。
- 验证计划：先运行现有 ChatVM/datasource 测试，再补并验证同组织并发、
  A→B→A、无组织切到有组织、账号/token/API 变化及 provider 返回到 SDK
  提交之间的微任务竞态。验证迟到置顶结果与失败不结束新请求的 loading，
  最后回归相关包、编译入口并独立 review。

1. 收口会话同步的请求、提交与失效代次。必须同时检查 ChatVM 和
   `apps/web/src/features/documentTitle/octoDocumentTitle.ts` 的 sync 调用。
2. 在 datasource/SDK 写入前拒绝过期请求，不能仅在 `await sync()` 后检查组织。
   当前安装的 `wukongimjssdk@1.3.5` 会先在自己的 Promise 回调中写缓存；
   datasource 当前对旧组织返回空数组，也可能让 SDK 把新缓存覆盖为空。
3. 迁移 ChatVM 的实时会话、频道信息和消息删除的数据维护：
   包含新群 pending、组织映射、父群/子区过滤、子区置顶保留和预览修正。
   只移动 HTTP sync 不足以支持后台。
4. 统一组织更新入口与完整快照订阅；ChatVM 只保留列表呈现、选中、滚动和路由。
5. 用 A→B→A、同组织并发刷新、换账号、旧 SDK 先写缓存后返回、
   重复挂载/卸载等测试验收后，再进入 W2 的 runtime/UI 双阶段接入。

当前总结 host 描述的身份必须与同一 renderer 中已安装的 Web 会话一致。
它不会为每个 controller 创建独立业务 store，也不会在不同
WebContentsView/partition 之间自动共享数据；这部分由 W2/C1 协议处理。

macOS/Windows 托盘常驻、宿主后台恢复、跨 WCV 唯一 owner、真实 artifact 联调
和设置业务接线尚未实施或验收。本轮没有提交、push 或创建 PR/MR。

### W1b 第二批：页面外数据所有权（已实现）

- 行为清单：共享 store 在无页面时可同步和处理实时更新；多个订阅者共享
  一组 SDK listener。最后一个生命周期持有者退出后撤销异步提交权限；
  页面卸载不得停止仍被桌面 owner 持有的数据服务。页面不因后台同步确认已读。
- 文件地图：`im-runtime/currentConversationStore.ts` 管理数据快照、同步、
  连接/组织生命周期和引用计数；`conversationRealtime.ts` 维护实时数据；
  `conversationSyncContext.ts` / `currentConversationSync.ts` 保留提交保护；
  `Pages/Chat/vm.ts` 改为订阅者，保留界面状态、滚动及导航。
- PR 范围：仅迁移会话数据所有权，不改变连接创建、通知规则、入口 UI 挂载、
  总结 provider 或 artifact 协议。桌面后台激活仍待 W2/C1。
- 验证计划：保留 ChatVM characterization tests，并覆盖无页面同步与事件、
  双持有者/页面卸载、重复 start/stop、组织切换、新群 pending、
  子区 pin/归档、删除预览、迟到请求及断网失败。修改后跑相关包并独立评审。

### 本轮实现与边界

- `currentConversationStore.ts` 是同一 SDK realm 的数据所有者，引用计数持有
  连接状态、会话、频道信息和消息删除 listener；`retain()` 不创建 IM 连接。
  无页面的 `ensureSnapshot()` 会临时持有生命周期，结束后释放。
- `currentConversationSync.ts` 直接调用既有 provider，避开 SDK `sync()` 的
  无条件缓存写入；同步提交同时检查身份、组织、API、provider、SDK 及请求代次。
  datasource 在转换与写映射/频道缓存之前验证提交权限。
- 同步或等待置顶期间收到实时更新时，放弃该次回包并重新请求权威快照。
  不把基于旧基线计算的 SDK 未读数混入服务端计数；最多立即重试三次，
  冲突持续时仅保留一个 1 秒校准 timer，旧快照标记 stale。
  延迟校准属于同一次 `refresh()` Promise；不会先结束 Promise、释放临时
  owner 再把 timer 一起取消。取消延迟等待时 Promise 也会完成，不遗留挂起等待者。
- 显式刷新、组织切换、最后一个生命周期持有者释放及 dispose 撤销旧请求
  和校准 timer；停止后在不同组织重新启动不会暴露旧列表。
  `ensureSnapshot()` 会等当前有效的替代请求结束，再释放临时持有者，
  避免旧组织请求的 `finally` 停掉新组织同步。
- 事件分发支持重入，确保前一个订阅者触发刷新时，后续 ChatVM 仍收到组织
  切换并清理选中会话/右栏。实时元数据通知后再次验证组织，避免重新插入旧群。
- `ownedChannelInfoFetcher.ts` 约束本轮实时数据维护发起的频道请求提交：
  每次请求捕获 provider、SDK、身份与生命周期；共享频道写代次保护原地更新，
  不枚举静音/置顶等个别业务字段。保留 Space 前缀私聊的合法 bare-UID 映射。
- 频道请求使用原共享 pending 追踪，成功、失败、过期都正常 settle 和清理。
  `channelSettingActions.ts` 的延迟静音修复同时检查原请求的结果提交权限，
  不能由旧 owner 间接回写新 owner 的缓存；legacy 请求保留原有修复语义。
  不代表所有历史页面发起的 SDK 请求都已迁移，也不代替 W2/C1 的 owner 撤销。
- 现有消息未读口径、免打扰、子区/父群过滤、置顶和显式已读行为不另建一套。
  普通 Web 与现有 Client artifact 仍使用原激活时机。

### W1b 最新验证

| 检查 | 结果 |
| --- | --- |
| `packages/dmworkbase` 全量 | 最终 498 文件、4946 项通过 |
| `packages/dmworkdatasource` 全量 | 12 文件、75 项通过 |
| `apps/web` 全量 | 单 worker，139 文件、1619 项通过 |
| `packages/dmworksummary` 全量 | 85 文件、1337 项通过 |
| 通信生产入口编译 | 通过 |
| 普通 Web、总结生产入口编译 | 均通过 |
| `apps/web` TypeScript | 基线 2666 条，当前 2665 条；规范化路径及行列偏移后无新增诊断，仍非通过 |
| 独立 review | R1-R13 问题全部修复；reviewer 最终 6 文件、112 项通过，无未关闭的已确认问题 |
| `git diff --check` | 通过 |

本轮生产编译使用 `VITE_API_URL=https://runtime-build.invalid`；内嵌编译另设置
`OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1`。这些仅用于构建验证，不是发布制品，不接入
真实账号，不更新 Client pin。仍需 W2/C1 的双阶段入口、跨 WCV 协议与真实制品
联调，以及 macOS/Windows 实机后台验收。

### 最终复核记录

- 评审回归覆盖：实时消息与 HTTP 同步冲突、离线跨组织重启、组织事件重入、
  迟到元数据、无页面与延迟校准生命周期、原地解散/置顶/归档写入、原有静音
  修复、Space 前缀私聊、旧 owner 的间接回写。
- 共享 pending tracker 保留输入 Promise 的精确类型。类型检查曾暴露三条
  `void` 扩宽诊断，修正泛型后消除；最终与同源码基线逐条对比无新增诊断。
- 一次最终全量发现 `groupDisband.test.ts` 的缓存 mock 缺少真实 ChannelInfo
  必有的 `channel`。补齐夹具后保留原断言，未放宽生产保护；最终全量通过。
- 实施 subagent 曾误操作已有 stash，产生冲突并误删四个已跟踪的原生展示文件。
  已按本轮初始 clean-path 清单恢复这些主干文件，核对三个冲突文件与原 HEAD
  一致、无额外删除、stash 列表恢复、暂存区为空。恢复后重新执行全量与生产编译；
  本批没有提交、push 或清理用户 stash。
- 本批 53 个源码/测试/包配置文件（不含 Markdown）的 SHA-256 指纹：
  `f7c7b163f74b30bbb269e09cba4247138663dcb40be7e2cab545e4bc2914ea9b`。
  计算方式与 W1a 一致；基线仍为 `03b64e2c`。后续 W2 改动需重新验证和 review。

最终命令：

```bash
pnpm --dir packages/dmworkbase exec vitest run --maxWorkers=2 --silent
pnpm --dir packages/dmworkdatasource exec vitest run --maxWorkers=1 --silent
pnpm --dir apps/web exec vitest run --maxWorkers=1 --silent
pnpm --dir packages/dmworksummary exec vitest run --maxWorkers=1 --silent
pnpm --dir apps/web exec tsc --noEmit --pretty false --incremental false
VITE_API_URL=https://runtime-build.invalid pnpm --dir apps/web run build
OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1 VITE_API_URL=https://runtime-build.invalid pnpm --dir apps/web run build:client-communication
OCTO_ALLOW_DIRTY_CLIENT_ARTIFACT=1 VITE_API_URL=https://runtime-build.invalid pnpm --dir apps/web run build:client-summary
git diff --check
```

### 下一批

进入 W2：在同一 communication artifact 内拆分 runtime 初始化与 UI 挂载，
增加受校验的能力协商与状态快照，并为 summary 接入 external provider。
之后才由 C1 在 Client 登录完成后常驻托管、处理后台恢复并固定真实 artifact。
不能仅把本批 store 提前创建，就视作桌面后台角标交付。
