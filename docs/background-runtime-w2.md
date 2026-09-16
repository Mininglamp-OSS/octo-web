# W2: Runtime/UI 双阶段接入

状态：2026-09-14，W2 实现、review 修复、普通 Web 完整浏览器 E2E 与编译
artifact mock 联调已推进；正式 artifact 尚未交付，不能等同于 C1 桌面生产常驻交付。

## 行为清单

- 没有 runtime bootstrap 时保持原有通信、总结入口行为。
- 受控 owner bootstrap 下，通信在未挂载 React 页面时启动会话数据服务与快照。
- runtimeReady 不等待网络成功或页面布局；uiReady 仍经过原展示屏障。
- 首次导航/转发才挂载通信 UI；不增加 IM 连接、未读订阅或已读确认。
- 总结 external 模式不启动本地 attention leader/polling，操作只请求 owner 刷新。
- 请求、快照、异步结果绑定 owner/context/epoch；失效上下文不能回写。
- 总结刷新由 owner 确认接收，携带 requestId/reason；确认不代表网络完成。

## 文件地图

- `apps/web/src/client-feature/runtimeContract.ts`：脱敏 runtime 协议与严格校验。
- `apps/web/src/client-communication/runtime/`：后台数据启动、快照与 UI 懒挂载。
- 通信入口、hostBridge、CommunicationShell：将 runtime 与页面职责分离。
- `packages/dmworksummary/src/runtime/` 及 attention badge facade：外部计数适配。
- 总结入口/hostBridge：在 provider 启动之前选择 local/external。
- 现有构建 manifest：仅声明已实现、经过测试的可选能力，保持 major/revision 兼容。

## PR 范围

本批实现 Web 端能力，不在 Client 重写业务计数。C1 仍需真实 owner 托管、
受控 IPC、快照镜像、后台恢复、调度与配套 artifact pin。W3/S2 设置业务接线
和 macOS/Windows 实机验证不能提前标记完成。

## 验证计划

- 无 UI 启动、一次连接/订阅、首次导航、重复导航、撤销/异常清理。
- malformed bootstrap、旧 scope、未知字段、计数与 revision 校验。
- 外部总结模式无本地请求/广播/leader；旧异步写入不得覆盖外部计数。
- 现有通信展示、转发、联系人、普通 Web 和总结测试回归。
- 生产入口构建、类型基线比较、独立 subagent review。
- Review 修复：逐次发送前 scope 校验、预览清理、刷新确认、轮询失效代次、
  suspend 队列及失败退避，各自增加回归测试。
- 本轮不执行 stash/reset/checkout，不操作已有用户 stash，不提交未经复核的改动。

## Review 修复

- 普通 Web 冷启动补充范围（2026-09-14）：
  - 行为清单：登录后不依赖 ChatPage 挂载也能处理延迟连接、重连和组织变化；
    登出停止应用持有，身份变化撤销旧请求；不新建 IM 连接、不触发已读。
  - 文件地图：`App/browserConversationRuntime.ts` 管理普通入口持有，
    `App/index.tsx` 绑定应用生命周期；共享 store 补 auth scope 事件；
    Main 生命周期测试及 X4 浏览器用例覆盖卸载、刷新和多标签页。
  - PR 范围：本批普通 Web 兼容性修复，复用 W1 数据所有者；
    不修改 Client owner、总结轮询、UI 布局或 release pins。
  - 验证计划：应用持有/释放及真实 store auth 回归、Main 迟到请求回归，
    重建普通 Web 后 X4 连续三轮和全量浏览器 E2E，最后独立 review。
- 总结串行发送在每次发送与回写前检查捕获的 scope；A→B→A 不恢复旧请求。
- 文档预览丢弃旧 scope 的迟到结果和 401，dispose/启动失败卸载 handler。
- `invalidateSummary` 使用 requestId/reason，owner 明确返回接收结果。
- fresh 与普通 poll 回包都受 mutation generation 保护；新请求排队后旧回包不能恢复 ready。
- executor 每轮取请求前检查 suspend，保留待执行 reason，在 resume 合并补发。
- 自定义 polling policy 增加失败回调；隐藏失败退避 60→120→240→300 秒。
- 普通 Web 不注入该 policy，原有浏览器退避、leader 与 API 兼容路径保留。

## 验证记录

输入：`03b64e2c` 加本 worktree 未提交改动；没有 push 或发布。

- Web 应用：148 文件、1,680 测试通过。
- 基础模块：500 文件、4,979 测试通过。
- 总结模块：88 文件、1,405 测试通过，含新增 5 项 review 专项回归。
- Datasource：12 文件、75 测试通过。
- `tsc --noEmit --pretty false`：仍有 2,665 条诊断；按文件、错误类型及消息
  对比上一轮 W2 基线（忽略行号变化），无新增。不能表述为类型检查通过。
- communication、summary 编译成功，manifest 宣告对应可选 runtime 能力。
- Client 用上述重新编译产物通过 4 项 runtime Electron E2E，覆盖 headless
  非零角标、懒 UI、壳重载、切组织、跨视图刷新确认、后台崩溃恢复、
  开关关闭的 legacy 模式和首次通知点击；另 2 项 S1 设置回归通过。
- Web 请求/预览/ACK 的独立复核未发现剩余确认 P1/P2。
- 2026-09-14 poll 专项独立复查已完成：mutation generation、suspend 队列保留、
  hidden 失败退避三项未发现确认 P1/P2；reviewer 未重跑测试，测试结果来自上述实测。
- Client 通知后续专项三项 P2 均已修复并经独立复核关闭；最新 Electron 用例
  由 mock SDK 消息驱动通知，通过真实旧 listener 验证点击打开目标会话。

本轮构建明确使用 dirty/mock 豁免，仅服务隔离 E2E。manifest 真实保留
`sourceDirty=true`、`e2eMock=true`，不能用于生产账号或 release pin。
真实 IM、通知、Windows、性能仍不能由这些结果替代。
普通 Web 完整浏览器回归已在后续批次执行，见下文。

测试使用无缓存 runner 与有限 worker，避免全量套件同时占满机器。
日志：`/tmp/octo-w2-web-bounded.log`、`/tmp/octo-w2-base-bounded.log`、`/tmp/octo-w2-summary-complete.log`、
`/tmp/octo-w2-poll-review.log`、`/tmp/octo-w2-datasource-final.log`、
`/tmp/octo-w2-types-final.log`。

## 普通 Web 兼容性收尾

2026-09-14，输入仍为 `03b64e2c` 加本 worktree 改动。
先运行原有普通 Web 浏览器套件，176/176 通过；新增 X4 生命周期用例后，
刷新通讯录丢失未读前缀的用例连续三轮失败，另外两组通过。
失败记录保留于 `/tmp/octo-w2-x4-e2e.log`，没有移除断言或在刷新后手动重连。

本批修复：

- 普通 Web 应用入口在已登录时持有共享 conversation store；标题的一次性
  `ensureSnapshot()` 结束不会移除唯一连接监听。延迟连接、重连和非消息页
  组织变化可以继续同步，不创建第二个 IM 连接，也不挂载消息 UI。
- store 处理 auth scope 变化，撤销旧请求并清空旧列表；即使 Chat 尚未卸载，
  登出后的迟到连接、实时数据和组织事件也不能继续发起同步或回写。
- Main 初始组织请求、切换后的后台刷新与延迟 workspace 确认，均增加
  组件挂载代次校验。旧实例先返回不再污染替代实例的组织上下文。
  独立 reviewer 已关闭 Main P2，并只读复核最终测试使用真实 context/space helper。
- 补齐原 ChatVM 频道监听测试中的已登录 token 夹具，保持原断言；
  新测试覆盖临时持有结束后的延迟连接、双持有者换账号、登出迟到事件与重复 auth。
- reviewer 组合探针另发现条件性同步重入可重复获取或遗留持有者；
  普通 Web adapter 增加获取中保护、获取后 auth/stop 复核及清理前撤销引用。
  3 项永久回归先验证旧版失败，再验证修复通过。独立复核运行 helper 9/9、
  真实 owner/store/sync/context/SDK/mitt 组合探针 8/8，最终 holder 归零、
  监听无残留，无剩余确认 P1/P2。探针的 snapshot/realtime 下游效果仍用 stub。

已完成的验证：

| 检查 | 结果 |
| --- | --- |
| X4 浏览器专项 | 最终 adapter 补丁后，3 场景连续 3 轮，9/9 通过 |
| 普通 Web 完整浏览器套件 | 最终构建 179/179 通过，4.4 分钟；上一轮 179/179 也通过 |
| 独立浏览器复测 | 通讯录在 mock IM 延迟安装后刷新，标题保持 `(1) 通讯录 - Octo` |
| 基础包全量 | 500 文件，4,983 通过 |
| Web 应用全量 | 最终 adapter 补丁后，150 文件，1,696 通过 |
| Main/App 持有专项 | 2 文件，16 通过；Main 含 7 项真实 helper 回归 |
| Web 类型基线对比 | 2,665 条，按文件/类型/消息多重集合比较无新增、无消失；仍未通过 |
| 重新编译 Web artifact 后的 Client Electron | 6/6 通过；4 项 runtime 与 2 项设置 |

本批 artifact 位于 `/tmp/octo-c1-browser-regression-artifacts/{communication,summary}`，
明确为 `sourceDirty=true`、`e2eMock=true`，只供隔离 E2E，未修改发布 pins。
Electron 首次使用相对 `--outDir` 导致 renderer 输出到 `src/renderer/out/`，
启动报 `ERR_FILE_NOT_FOUND`；保留失败记录，改为绝对目录、检查入口和 preload
文件后完整重跑通过。没有为通过测试修改业务超时或跳过用例。

日志：`/tmp/octo-w2-x4-reviewed-e2e.log`、`/tmp/octo-w2-browser-reviewed-e2e.log`、
`/tmp/octo-w2-base-browser-final.log`、`/tmp/octo-w2-browser-reentry-green.log`、
`/tmp/octo-w2-web-browser-reviewed.log`、`/tmp/octo-w2-types-browser-reviewed.log`、
`/tmp/octo-c1-browser-electron-final.log`。

最终 109 个改动源码/测试/包配置文件（不含 Markdown）的 SHA-256 指纹：
`5ef38eab08979912370cdfd4001171eb3976f5808a5cded7acff7af97d1ccf98`。
计算方式为路径去重排序后拼接 `path + NUL + file bytes + NUL`，不表示干净提交。
后续提交、rebase 或修改后需要重新确认受影响测试和 review 范围。

本次只 fetch 主干：Web `upstream/main` 为 `8678766f`，比工作基线前进 1 项；
Client `origin/main` 为 `f077c61`，前进 7 项。尚未 rebase、提交或 push。
正式 artifact 需要先固定干净且已评审的源码，再依次处理重放主干后的验证、
非 mock 构建、checksum、Client 接入和真实环境验收，不能沿用本批 mock 结论。
