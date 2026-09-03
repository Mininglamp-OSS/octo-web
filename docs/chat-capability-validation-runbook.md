# Octo 聊天能力与 Client 集成验证手册

> 日期：2026-09-03  
> 目标：同时证明 octo-web 原有能力没有被破坏，并证明 octo-buddy-client 集成链路可用于真实交付。

## 1. 验证原则

本次验证分成四道门禁：

1. **Web 回归门禁**：原有聊天、通讯录和跨模块功能继续通过。
2. **能力边界门禁**：`chat-core`、`chat-react` 和业务 `ConversationWindow` 的生命周期正确。
3. **Artifact 门禁**：Client 使用的确实是指定 octo-web 提交构建出的生产产物。
4. **Client 集成门禁**：布局、登录态、Space、导航、异常恢复和打包均正常。

只有四道门禁全部通过，才能判定集成成功。

## 2. 当前代码位置

```text
octo-web:
/Users/will/Project/octo/octo-web-chat-capability-vertical-slice

octo-buddy-client:
/Users/will/Project/octo/octo-buddy-client-chat-capability-integration
```

验证时以待发布分支的实际 HEAD 为准：

```text
octo-web              <git rev-parse --short HEAD>
octo-buddy-client     c334476
```

先检查工作分支：

```bash
git -C /Users/will/Project/octo/octo-web-chat-capability-vertical-slice status --short --branch
git -C /Users/will/Project/octo/octo-web-chat-capability-vertical-slice log -1 --oneline

git -C /Users/will/Project/octo/octo-buddy-client-chat-capability-integration status --short --branch
git -C /Users/will/Project/octo/octo-buddy-client-chat-capability-integration log -1 --oneline
```

正式生成和交付 artifact 前，源码工作树必须 clean，并重新执行本手册中的测试与构建。开发中间态可以包含本次修复，但需要在验收记录中注明。

## 3. 门禁一：验证 octo-web 没有被破坏

### 3.1 新能力基础测试

```bash
cd /Users/will/Project/octo/octo-web-chat-capability-vertical-slice

pnpm --filter @octo/chat-core test
pnpm --filter @octo/chat-react test
```

通过标准：

- `chat-core`：54 tests passed。
- `chat-react`：24 tests passed。
- 没有 failed、unhandled rejection 或测试进程异常退出。

`chat-react` 测试中可能出现 `useChatClient must be used within a <ChatProvider>` 错误栈，这是测试故意验证错误边界时产生的日志。只要最终结果为 24 passed，就不是失败。

### 3.2 原有基础包全量回归

```bash
pnpm --filter @octo/base test
```

通过标准：

- 473 test files passed。
- 4325 tests passed。
- 退出码为 0。

JSDOM 可能输出 `HTMLMediaElement.play()`、`load()` 或 `window.open()` 未实现提示。这些是已有测试环境限制，最终 tests passed 即可。

这一步是确认 `ChatPage`、`ThreadPanel`、`Conversation` 和 `WKLayout` 的改造没有破坏原有组件行为。

### 3.3 octo-web 全量构建

```bash
pnpm build
```

通过标准：

- Turbo 所有目标完成。
- `apps/web` 正常生成生产 build。
- 没有 TypeScript、Vite、Rollup 或模块解析错误。

### 3.4 原有 Web 聊天与通讯录 E2E

推荐至少运行下面五组已有用例：

```bash
pnpm --filter @octo/web test:e2e -- \
  e2e-kit/tests/chat/chat-main-flow.spec.ts \
  e2e-kit/tests/chat/chat-interactions.spec.ts \
  e2e-kit/tests/chat/chat-layout-coverage.spec.ts \
  e2e-kit/tests/contacts/contacts-main-flow.spec.ts \
  e2e-kit/tests/cross-module/X1-cross-module-chat-summary-return.spec.ts
```

它们分别证明：

| 用例 | 主要验证内容 |
| --- | --- |
| `chat-main-flow` | 会话列表、打开会话、基础发送和聊天主流程 |
| `chat-interactions` | 消息交互、编辑器和会话操作 |
| `chat-layout-coverage` | 原 Web 布局及聊天区域没有被嵌入模式影响 |
| `contacts-main-flow` | 联系人、群组及从通讯录进入会话 |
| `X1-cross-module-chat-summary-return` | 聊天与摘要等既有跨模块导航 |

通过标准：

- 所有用例退出码为 0。
- 原始 Web 页面仍有自己的导航结构。
- 聊天页面不是强制进入 Client 的 embedded 布局。
- 通讯录进入会话后，返回和跨模块跳转行为保持原样。

### 3.5 与 upstream/main 做差分回归

若需要最强的“没有破坏”证据，应在相同机器、相同 Node/pnpm 和相同测试数据下，对 `upstream/main` 与功能分支运行同一组 E2E。

建议记录：

| 指标 | upstream/main | 功能分支 |
| --- | --- | --- |
| E2E 通过数 | 记录实际结果 | 记录实际结果 |
| 失败用例 | 记录实际结果 | 不允许新增失败 |
| 页面截图 | 基线 | 不允许非预期布局变化 |
| 首次进入聊天耗时 | 基线 | 不应出现明显退化 |
| WebSocket 连接数 | 基线 | 不应出现重复连接 |

判定规则：功能分支不能出现基线没有的新失败。已有不稳定用例应单独记录，不能通过重试掩盖。

### 3.6 真实后端人工冒烟

启动 octo-web：

```bash
pnpm dev
```

使用真实账号至少完成：

- 登录并进入原 Web 消息页面。
- 打开单聊和群聊。
- 发送一条文本消息。
- 发送一个小文件或图片。
- 收到一条对端消息并看到未读变化。
- 切换两个会话，确认消息没有串会话。
- 打开 ThreadPanel，确认辅助会话不抢占主会话。
- 进入通讯录，从联系人和群组分别发起会话。
- 切换 Space 后检查会话和通讯录数据已切换。
- 刷新页面后重新进入聊天。

失败判定：重复消息、重复连接、会话串台、发送状态不更新、返回错误页面、ThreadPanel 抢占主会话，均视为阻断问题。

## 4. 门禁二：验证能力拆分本身

### 4.1 `ManagedChatClient` 生命周期

由 `chat-core` 的 54 项测试覆盖：

- 重复 `start()` 不建立第二条连接。
- 重复 `stop()` 不重复释放。
- stop 是完整 teardown barrier。
- 快速切换会话时最新请求获胜。
- 旧连接 epoch 的迟到回调失效。
- lease 重复 release 安全。
- adapter 失败进入 failed 状态。

### 4.2 React 会话边界

由 `chat-react` 的 24 项测试覆盖：

- mount 打开会话。
- unmount 释放会话。
- channel 改变释放旧会话并打开新会话。
- `activate=false` 不占用主会话。
- 异步旧请求迟到后立即释放。
- 组件卸载后不更新 state。

### 4.3 octo-web 自己消费新组件

人工或代码审阅需要确认：

- `ChatPage` 使用 `Components/ConversationWindow`。
- `ThreadPanel` 使用 `ConversationSurface`。
- 两者通过同一个 `getLegacyChatRuntime()` 获取共享 client。
- 没有为 Client 复制第二份消息渲染或编辑器实现。

## 5. 门禁三：验证生产通信 Artifact

### 5.1 构建生产产物

```bash
cd /Users/will/Project/octo/octo-web-chat-capability-vertical-slice

VITE_API_URL=<实际 API Origin> \
pnpm --filter @octo/web build:client-communication
```

不要设置：

```text
VITE_E2E_MOCK=1
VITE_E2E_MOCK_IM=1
```

否则生成的是测试产物，Client 的生产准备脚本会拒绝它。

### 5.2 检查 manifest

```bash
cat apps/web/build-client-communication/renderer-manifest.json
```

预期关键字段：

```json
{
  "schemaVersion": 1,
  "name": "octo-web-client-communication",
  "version": "1.0.12",
  "commit": "<git rev-parse --short HEAD>",
  "entry": "index.html",
  "hostBridgeMajor": 1,
  "e2eMock": false
}
```

任何 version、commit 或 Bridge major 不匹配都应阻止进入 Client 构建。

### 5.3 准备 Client 产物

```bash
cd /Users/will/Project/octo/octo-buddy-client-chat-capability-integration

OCTOBUDDY_COMMUNICATION_SOURCE=/Users/will/Project/octo/octo-web-chat-capability-vertical-slice/apps/web/build-client-communication \
pnpm prepare:communication-artifact
```

随后比较：

```bash
cat resources/communication/expected-renderer.json
cat resources/communication/renderer/renderer-manifest.json
```

通过标准：version、commit、name、schemaVersion 和 hostBridgeMajor 完全一致，实际 manifest 的 `e2eMock` 为 `false`。

## 6. 门禁四：验证 Client 集成成功

### 6.1 静态与单元测试

```bash
cd /Users/will/Project/octo/octo-buddy-client-chat-capability-integration

pnpm typecheck
pnpm test:unit
```

通过标准：

- typecheck 退出码为 0。
- Client unit tests 49 passed。
- artifact、IPC 参数、恢复限流、下载安全测试全部通过。

### 6.2 Electron 通信 E2E

先生成仅用于测试的通信 artifact：

```bash
cd /Users/will/Project/octo/octo-web-chat-capability-vertical-slice

VITE_API_URL=http://mock.e2e.local \
VITE_E2E_MOCK=1 \
VITE_E2E_MOCK_IM=1 \
pnpm --filter @octo/web build:client-communication
```

将测试 artifact 复制到 Client。只有这一步允许显式放行 E2E 产物：

```bash
cd /Users/will/Project/octo/octo-buddy-client-chat-capability-integration

OCTOBUDDY_COMMUNICATION_SOURCE=/Users/will/Project/octo/octo-web-chat-capability-vertical-slice/apps/web/build-client-communication \
OCTOBUDDY_ALLOW_E2E_COMMUNICATION_ARTIFACT=1 \
pnpm prepare:communication-artifact
```

确认测试 manifest 中 `e2eMock` 为 `true`，然后执行：

```bash
pnpm test:e2e -- tests/e2e/communication.spec.ts
```

通过标准：12 tests passed。

该套 E2E 必须证明：

- Client 有消息和通讯录入口。
- 两个入口复用同一个 WebContentsView。
- embedded 模式不会显示 octo-web 自己的主导航栏。
- 可以从通讯录联系人和群组发起会话。
- 可以输入并发送消息。
- 可以选择附件。
- 内部跳转会同步 Client 侧栏状态。
- 首次加载目标会话不会丢失。
- Client 可传入 `channelId/channelType`，以 `conversation` presentation 打开现有频道。
- 独立会话模式隐藏左侧列表并让聊天窗口填满通信区域。
- 切回消息入口后恢复 `workspace` presentation，不重建 WebContentsView。
- 首载期间 Space 更新不会被旧 ready 状态覆盖。
- 隐藏后迟到导航不会抢回页面。
- renderer 崩溃按限制自动恢复。
- renderer 无响应后可以手动重试。
- 同 UID token 更新后 renderer 会重载。

E2E 完成后必须恢复生产 artifact：

```bash
cd /Users/will/Project/octo/octo-web-chat-capability-vertical-slice

VITE_API_URL=<实际 API Origin> \
pnpm --filter @octo/web build:client-communication

cd /Users/will/Project/octo/octo-buddy-client-chat-capability-integration

OCTOBUDDY_COMMUNICATION_SOURCE=/Users/will/Project/octo/octo-web-chat-capability-vertical-slice/apps/web/build-client-communication \
pnpm prepare:communication-artifact
```

最后再次确认 Client 内实际 manifest 的 `e2eMock` 为 `false`。测试 artifact 不能用于 `pnpm build:mac` 或其他发布打包。

### 6.3 Client 构建

```bash
pnpm build
```

通过标准：

- packages 构建成功。
- Electron main、preload 和 renderer 构建成功。
- communication preload 被正确生成。
- 没有缺失 artifact 或 manifest 不匹配错误。

发布前建议再执行对应平台打包，例如 macOS：

```bash
pnpm build:mac
```

安装包中应包含 `resources/communication/renderer`，并且启动后不依赖 octo-web 源码目录或开发服务器。

### 6.4 真实账号人工验收

启动 Client：

```bash
pnpm dev
```

按顺序验证：

1. 使用 Client 原有登录入口登录。
2. 点击“消息”，应在 Client 中央区域显示 octo-web 会话列表和聊天窗口。
3. 点击“通讯录”，应复用原 View，不闪回登录页，不重新初始化整套应用。
4. 点击一个联系人并选择“发送消息”，Client 侧栏应自动切换到“消息”。
5. 点击“独立会话”，应默认复用刚才选择的真实频道；也可输入已有的 `channelId` 和 `channelType` 后点击“加载”。
6. 独立会话只显示聊天窗口，不显示左侧会话列表；历史消息和编辑器应正常可用。
7. 切回“消息”，左侧会话列表应恢复，且不应出现第二条 IM 连接。
8. 发送文本、图片或文件，对端能够收到，发送状态正常。
9. 从对端发送消息，Client 左侧消息入口显示未读数。
10. 在消息和通讯录之间反复切换，不应重复连接或重复收到消息。
11. 切换 Space，通信内容应切换到新 Space。
12. 最小化、隐藏和恢复 Client，通信内容仍可继续使用。
13. 打开 Client 弹窗遮挡通信区域时，原生 View 不应盖住弹窗。
14. 更新同账号 token 后，通信 renderer 应自动重载并继续工作。
15. 退出登录后，旧账号聊天内容不应继续显示。

### 6.5 开发者工具辅助检查

人工验收时建议同时检查：

- Network 中只有一条主要 IM WebSocket 连接。
- 消息/通讯录切换不会新增第二条连接。
- Console 没有重复 listener、setState after unmount 或 IPC sender 拒绝错误。
- `renderer-manifest.json` 来自预期 commit。
- 页面切换时 Client 主 renderer 不刷新。
- 通信 renderer 崩溃或重载时 Client 主界面不退出。

## 7. 最小验收集

时间有限时，至少执行以下命令：

```bash
# octo-web
pnpm --filter @octo/chat-core test
pnpm --filter @octo/chat-react test
pnpm --filter @octo/base test
pnpm build

# octo-buddy-client
pnpm typecheck
pnpm test:unit
pnpm test:e2e -- tests/e2e/communication.spec.ts
pnpm build
```

再人工完成四个动作：

1. 原 octo-web 打开会话并发送消息。
2. Client 打开消息并发送消息。
3. Client 从通讯录联系人发起会话。
4. Client 切换 Space 后继续打开和发送消息。

自动化全部通过且四个人工动作成功，才能作为最小可接受结论。

## 8. 验收记录模板

```text
验证日期：
验证人：
octo-web commit：
client commit：
artifact version / commit：

[ ] chat-core 54 passed
[ ] chat-react 24 passed
[ ] @octo/base 4325 passed
[ ] octo-web 113 files / 1419 passed
[ ] octo-web build passed
[ ] Web chat/contact E2E passed
[ ] production artifact e2eMock=false
[ ] Client typecheck passed
[ ] Client unit 49 passed
[ ] Client communication E2E 12 passed
[ ] Client build passed
[ ] octo-web 真实账号冒烟 passed
[ ] Client 真实账号冒烟 passed
[ ] Space 切换 passed
[ ] 登录/退出/token 轮换 passed
[ ] 单 WebContentsView / 单 IM 连接 passed

新增失败：
已知非阻断问题：
最终结论：通过 / 有条件通过 / 不通过
```
