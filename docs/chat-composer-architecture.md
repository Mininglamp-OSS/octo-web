# Chat Composer 架构与开发指南

> 状态：核心重构已落地。旧 `Components/MessageInput` 实现已删除，生产聊天输入框使用
> `features/chat-composer`。
>
> 适用范围：`packages/dmworkbase` 中的聊天输入、发送事务、mention、emoji、附件、粘贴、
> 快捷键、失败恢复和 pending preview。

## 1. 结论

Chat Composer 现在以一次发送事务为核心，而不是把发送视为一个返回 boolean 的 React
回调。一次发送由稳定的 `attemptId` 贯穿 capture、consume、queue、transport、settle 和
recovery。

当前生产路径为：

```text
Conversation composition root
  -> createDefaultChatComposerExtensions()
  -> ChatComposer
  -> ChatComposerCoordinator
  -> createConversationChatSendHandler()
  -> buildChatSendPlan()
  -> executeChatSendPlan()
  -> ConversationChatTransport
  -> settleChatSendExecution()
  -> editor restore/dispose or ComposeRecoveryStore
```

重构完成的关键事实：

- `Conversation` 不读取 Tiptap 文档，也不直接操作 composer 附件 store。
- `ChatComposerCoordinator` 统一捕获 target、draft、channel、expanded 和 editor compose。
- capture 后同步 consume，连续发送进入串行队列，不再由 re-entrancy guard 丢弃。
- transport 每次 attempt 都快照 operation handlers，运行中的发送不受后续扩展变更影响。
- settle 决定恢复、释放、target 回填和 recovery handoff，下一任务只在 settle 完成后开始。
- `ChatComposerExtensions` 是实例级依赖，由 composition root 创建并同时注入 editor、send、
  render；生产路径不依赖模块级 registry 单例。
- `MessageInputContext.send()` 返回显式 `ChatComposerSendResult`，不再返回
  `void | boolean | object`。
- feature 对外入口是 `features/chat-composer/index.ts`；轻量语音调用使用
  `features/chat-composer/voice.ts`，避免加载完整 ChatComposer 图。

## 2. 目录与职责

```text
features/chat-composer/
  index.ts                         公共入口
  voice.ts                         轻量语音公共子入口

  domain/
    types.ts                       request、outcome、settlement、公开 send result
    sendPlan.ts                    operation 与 plan DTO
    composeAttemptLedger.ts        pending attempt 唯一事实源
    editorCompose.ts               editor capture 的稳定中间模型
    mentionMarker.ts               mention canonical marker

  application/
    ChatComposerCoordinator.ts     单次提交事务协调器
    ChatComposerController.ts      pending/queue/ledger 状态
    composeConsume.ts              同步 consume 与可恢复资源租约
    buildChatSendPlan.ts            纯计划构建
    executeChatSendPlan.ts          operation 执行用例
    settleChatSendExecution.ts      transport result -> outcome
    sendFlow.ts                     queue、settle、恢复辅助函数

  ports/
    ChatComposerEditorPort.ts       editor capture/consume/restore 边界
    ChatComposerHostPort.ts         target/draft/channel/settlement 边界
    ChatTransportPort.ts            发送计划的外部执行边界

  adapters/
    conversation/                   SDK、上传、入队、ack、send target adapter
    tiptap/                         Tiptap 节点、mention/emoji suggestion、发送解析
    voice/                          语音输入 hook

  editor/
    attachmentStore.ts              top/inline 附件所有权
    composePartRegistry.ts           editor part capture/restore/dispose

  extensions/
    ChatComposerExtensions.ts        实例扩展 bundle
    ChatSendOperationRegistry.ts     operation handler 注册表
    PendingComposeRenderRegistry.ts  pending preview 注册表

  clipboard/                        secret、RichText、HTML、文件粘贴策略
  keyboard/                         Enter/IME/suggestion/slash policy
  recovery/                         跨实例临时恢复与资源释放
  ui/                               ChatComposer、suggestion、pending/voice UI
```

允许保留在 feature 外的职责：

- `ConversationContext`、当前 channel、reply/edit 状态和远端草稿状态。
- `WKApp`、WuKongIM SDK、上传服务、消息状态、通知和埋点。
- 通用应用 UI，例如 modal、avatar、slash command 数据源。
- 历史消息 renderer。composer pending renderer 不负责接收侧消息展示。

这些能力必须通过 port 或 conversation adapter 进入发送事务，不能反向渗入 domain。

## 3. 发送事务

### 3.1 提交前拒绝

`ChatComposer.send()` 在 consume 前完成以下检查：

- editor 是否就绪。
- 文本是否超过长度限制。
- editor part 是否都有可发送 adapter。
- host 是否提供发送能力。
- compose 是否为空。

拒绝结果必须是：

```ts
type ChatComposerSendRejection = {
  kind: "rejected";
  editorConsumed: false;
  reason:
    | "editor-not-ready"
    | "message-too-long"
    | "unsupported-content"
    | "send-host-unavailable"
    | "empty-compose";
};
```

拒绝不允许伪装成成功，也不允许用 `false` 丢失原因。

### 3.2 已发起的 attempt

通过预检后，coordinator 同步执行：

1. 捕获 send target、draft baseline、channel key 和 expanded 状态。
2. 捕获 text、mention、top attachments 和 editor blocks。
3. 分配 `attemptId`，把 compose 从 editor 转成带所有权的 consumed handle。
4. 将 attempt 放入 controller/ledger 和串行队列。
5. 在队列中调用 host send handler。
6. settle outcome，恢复或释放资源。
7. 调用 `onSendSettled`；若原 editor 已销毁，将 recovery 交给对应 channel。

已发起结果必须是：

```ts
type ChatComposerSendAttemptResult = {
  kind: "attempted";
  attemptId: string;
  editorConsumed: boolean;
  outcome: ChatSendOutcome;
};
```

`editorConsumed:false` 在这里表示 attempt 已运行但内容需要保留或恢复，不等同于提交前拒绝。

### 3.3 连续发送

consume 在第一次 await 之前完成。因此用户可以在第一条消息上传或等待 ack 时继续输入并发送。
后续 attempt 捕获自己的 editor、target 和 draft 快照，再进入串行执行。

队列约束：

- 前一 attempt 必须完成 settle、resource handoff 和 ledger remove，下一 attempt 才能执行。
- operation handlers 在 attempt 开始时快照，不能在执行中读取可变 registry。
- 相同文本仍是两个不同 attempt，草稿归属只能按 attempt ID 判断。

## 4. 数据与所有权

### 4.1 三种文本

```text
previewText  pending UI 展示文本，例如 @Alice
draftText    可恢复 canonical 文本，例如 @[uid:Alice]
sendText     wire 文本和 mention sidecar
```

三者不能由同一个字符串隐式承担。

### 4.2 附件

- top attachments 通过 snapshot/take/restore 转移所有权。
- inline attachments 通过 live/leased/handoff 生命周期管理。
- object URL 必须由 owning extension 或 recovery store 显式 dispose。
- 部分发送成功时只释放已消费 part，未发送 part 精确恢复。

### 4.3 跨实例 recovery

发送期间切换频道或卸载 editor 时，失败 compose 不能回写旧 editor：

```text
old coordinator settle
  -> ComposeRecoveryStore.add(channelKey, record)
  -> active Conversation subscriber
  -> suppress the exact provisional draft owned by pending attempt IDs
  -> hydrate failed attempts in arrival order
  -> atomically consume recovery ownership and publish the hydrated live draft
```

`ComposeRecoveryStore` 同时管理 recovery record 和 session 草稿 revision，不能拆成两个独立
store。每次远端草稿写入都会生成新 revision；settlement 只有在 revision 未变化，或当前草稿仍
由自己的 `attemptId` 持有时才能清理。即使新旧草稿文本完全相同，也不能绕过 revision 和
attempt ownership。发送捕获的 revision 使用引用计数 lease，直到 settlement `finally` 释放；
活跃发送不会因 TTL 或频道容量淘汰而失去清理依据。

recovery record 是 session 内存级：每频道最多 20 条、最多 50 个频道、TTL 30 分钟。record
过期或被淘汰时，对应 provisional draft ownership 必须同时释放，使远端草稿重新可见。正在
运行但尚未产生 recovery 的 attempt ownership 不按时间单独过期，由 settlement 或频道容量
淘汰结束。

hydration 成功后必须立即把 editor 的 canonical draft 回写到远端；部分成功时不能继续保留包含
已发送 part 的旧 provisional draft。hydration 先对同一批 recovery 做完整 preflight，任一记录
无法构建或附件资源 ID 冲突就整批不应用、不 acknowledge，避免成功子集覆盖仍依赖 provisional
draft 的失败子集。

所有远端草稿 POST 通过 session 级 `ComposeDraftWriteQueue` 按 channel 串行执行。旧实例的
provisional 保存必须先于新实例的 hydration 精确回写完成，不能只保证内存 revision 正确而让
服务端最终落盘顺序反转。
当前实现不会把 `File` 写入 IndexedDB，也不承诺浏览器崩溃或刷新后的附件恢复。需要跨重载
恢复时，应单独设计 durable outbox。

## 5. 扩展模型

### 5.1 实例扩展 bundle

composition root 必须只创建一次：

```ts
const extensions = createDefaultChatComposerExtensions<Message>();
```

同一个 `extensions` 实例同时传给：

- `<ChatComposer extensions={extensions} />`
- `createConversationChatSendHandler({ extensions, ... })`

这样 editor capture、send operation 和 pending render 使用同一个扩展世界。不得在组件 render
期间重复创建，也不得恢复模块级可变单例。

### 5.2 新增可发送 editor part

一个新 part 至少需要三段能力：

1. editor：注入 Tiptap extension，并提供 compose part 的 capture、restore、dispose、
   toSendBlock。
2. send operation：planner 生成 operation，registry 注册 handler。
3. pending renderer：为发送中状态提供稳定 UI。

最小注册形态：

```ts
extensions.editor.tiptap.push(PollNode);
extensions.editor.composeParts.register({
  id: "poll",
  canCapture: (node) => node.type === "poll",
  capture: (node) => ({
    id: String(node.attrs?.id),
    kind: "poll",
    extensionId: "poll",
    placement: "block",
    node,
  }),
  restore: (part) => part.node,
  dispose: (part, context) => {
    // 仅资源型节点需要；释放逻辑由扩展自己拥有。
  },
  toSendBlock: (part) => ({
    type: "extension:poll",
    id: part.id,
    payload: { question: part.node.attrs?.question },
  }),
});

extensions.send.operations.register("extension:poll", async (operation, events) => {
  const message = await sendPoll(operation.payload);
  events.onEnqueued(operation.partIds);
  return { enqueuedPartIds: operation.partIds, messageId: message.id };
});

extensions.render.pending.register({
  id: "poll",
  priority: 100,
  canRender: (attempt) =>
    attempt.editorBlocks.some((block) => block.type === "extension:poll"),
  render: (attempt) => <PendingPoll attempt={attempt} />,
});
```

`placement` 默认按 inline part 处理；顶层卡片、投票等 block node 必须显式写
`placement: "block"`，否则部分失败恢复时会被包进 paragraph。part `id` 在一次 editor
document 中必须全局唯一，不能只在各扩展内部唯一。

实现顺序：

```text
schema/runtime validation
  -> editor capture/restore/dispose
  -> send operation + transport handler
  -> settlement/recovery mapping
  -> pending renderer
  -> focused tests
  -> production composition root registration
```

只有 operation handler 而没有 restore/dispose，不算完整扩展。发送前遇到无 adapter 的 editor
part 必须 fail closed，保留原 editor 内容。

### 5.3 当前扩展限制

- attachment 和 `extension:*` 已完成 capture -> pending -> plan -> operation -> settle ->
  recovery 的事务闭环。
- text/mention 仍有专用捕获与解析路径，尚未全部变成通用 editor part。
- extension payload 当前是 `unknown`；扩展自己的 operation handler 必须做 schema/runtime
  validation，不能信任调用方输入。
- 跨实例 recovery 会保留 Tiptap node snapshot 和内存中的 attachment `File`/object URL；如果
  新扩展持有 snapshot 之外的临时资源，需要由扩展增加对应的资源 handoff 设计，不能把资源只
  放在 React component state 中。
- 历史消息 renderer 继续按消息 content type 注册，不复用 pending renderer。
- `ChatComposer.tsx` 仍包含较多 UI/editor 装配代码；后续可以拆视觉组件，但不应再次拆散事务
  所有权。

## 6. UI 变更指南

当前架构支持在不改发送事务的前提下调整 UI。常见变更位置：

| 需求                   | 修改位置                                     | 不应修改                   |
| ---------------------- | -------------------------------------------- | -------------------------- |
| 输入框布局、边距、颜色 | `ui/ChatComposer.tsx`、`ui/ChatComposer.css` | coordinator、transport     |
| 工具栏按钮             | `ChatComposerProps.toolbar` 或独立 UI 组件   | send plan 主循环           |
| mention/emoji 面板     | `ui/suggestions/`、Tiptap suggestion adapter | draft/settle               |
| pending preview        | `PendingComposeRenderRegistry` renderer      | Conversation 分支          |
| 新 editor 节点外观     | Tiptap NodeView + editor extension           | SDK adapter                |
| 语音指示器             | `ui/voice/`                                  | ChatComposer send contract |

UI 改动必须保持：

- editor DOM 和 suggestion popup 的生命周期不因状态更新被重复卸载。
- emoji/mention 选择后先完成 Tiptap transaction，再关闭 popup，避免闪回。
- IME composing 时 Enter 不触发发送。
- 控件尺寸稳定，pending 数量、长文件名和翻译文本不能推动整体布局跳动。
- 视觉组件只接收状态与动作，不读取 SDK、草稿所有权或 transport result。

如果只是换皮、移动按钮或重做附件托盘，通常只改 UI 层和视觉测试；如果新增一种可编辑且可
发送的内容，则按扩展模型完成全链路。

## 7. Clipboard 与 Keyboard

clipboard 优先级固定为：

```text
secret guard
  -> Octo RichText payload
  -> external HTML link conversion
  -> image/file paste
  -> plain text fallback
```

HTML 使用 `DOMParser`，只保留安全的 `http/https` 链接。secret guard 永远最高优先级。

键盘优先级：

1. IME composing：交给输入法。
2. mention/emoji suggestion active：交给 suggestion plugin。
3. slash menu：处理选择、关闭和导航。
4. Alt+Enter：执行替代动作。
5. Enter 且非 Shift：提交。
6. Shift+Enter：交给 Tiptap HardBreak。

## 8. Conversation 边界

`Conversation` 负责 composition root 和宿主能力：

- 创建实例级 extensions。
- 提供 send target、draft、channel、reply/edit 状态。
- 提供上传、SDK content 构造、入队和 ack handlers。
- 持有跨 ChatComposer 实例的 recovery store。
- 通过同一 store 记录远端草稿 revision 与 pending attempt ownership。
- 通过 `createConversationChatSendHandler` 适配发送事务。

`Conversation` 不得：

- 读取或修改 Tiptap JSON。
- 直接 take/restore composer attachment store。
- 绕过 ChatComposer 发送 initial compose。
- 在队列执行时重新读取 live reply/edit target。
- 根据内容字符串猜测草稿属于哪个 attempt。
- 让旧实例 settlement 在未验证 session revision 时清理远端草稿。

## 9. 公共入口

feature 外部代码优先从以下入口导入：

```ts
import {
  ChatComposer,
  createDefaultChatComposerExtensions,
  type ChatComposerSendResult,
} from "../../features/chat-composer";

import { useVoiceInput } from "../../features/chat-composer/voice";
```

规则：

- 不从 `domain/`、`ui/`、`extensions/`、`recovery/` 等内部目录深导入。
- 仅需语音 hook 时使用 `voice.ts`，避免总入口引入完整 UI 图。
- feature 内部测试可以直接测试所属模块；feature 外生产代码使用公共入口。
- 包消费者可以从 `@octo/base` 使用根入口已公开的 composer contract。

## 10. 测试与验收

### 10.1 自动化测试

```bash
cd packages/dmworkbase
pnpm test

cd ../..
pnpm --filter @octo/web build
```

重点测试覆盖：

- rapid consecutive sends 的捕获顺序和队列隔离。
- target/draft/channel/expanded 的 capture-time 语义。
- partial enqueue、restore error、recovery handoff 和资源 dispose。
- extension bundle 隔离、Tiptap node 注入、自定义 operation、pending renderer、部分失败和
  cross-instance recovery。
- mention 实例隔离、emoji/mention Shift+Enter、clipboard handler 优先级。
- initial compose 的 prepared/rejected/attempted/throw 分支。

### 10.2 浏览器验收

每次修改 UI、keyboard、clipboard、editor lifecycle 或 Conversation 装配后，至少验证：

1. 中文输入法候选期间按 Enter 不发送；确认文字后 Enter 只发送一次。
2. 粘贴真实 HTML 链接，安全 URL 正确转 Markdown，普通 `.md` 文本不误判。
3. 第一条消息等待上传或 ack 时立即输入并发送第二条，两条内容和顺序正确。
4. pre-enqueue 阶段切换会话，旧内容不进入新会话，失败内容恢复到原 channel。
5. recovery 文本与 provisional draft 相同也只出现一次；附件只恢复一份。
6. emoji/mention 选择后 popup 一次关闭，不闪回。
7. 文本、top attachment、inline attachment、RichText 和自定义 editor part 的发送与失败恢复。
8. reply/edit target 在点击发送时固定，后续切换选择不改变已排队 attempt。

## 11. Review 与提交纪律

关键节点必须按以下顺序完成：

1. 聚焦测试通过。
2. Web 生产构建通过。
3. 独立 reviewer 检查事务语义、资源所有权、扩展边界和缺失测试。
4. 关闭所有 actionable findings。
5. 运行完整 `dmworkbase` 测试。
6. 提交单一主题 commit。

禁止把未验证的视觉改动、发送语义变化和目录整理混在同一个提交中。

## 12. 后续工作

核心重构已完成，后续工作是增量演进，不再依赖旧架构：

- 将 text/mention capture 逐步统一到 editor compose part contract。
- 根据真实扩展数量评估是否把 `extension:*` payload 从 `unknown` 收紧为 declaration map。
- 若出现拥有独立临时资源的扩展，为 recovery 增加通用 resource handoff contract。
- 从 `ChatComposer.tsx` 拆出纯视觉组件，保持 coordinator 和 ports 不变。
- 为关键浏览器场景建立稳定的 Playwright/端到端 fixture，减少人工验收成本。
- 只有明确要求跨刷新恢复附件时，才设计 durable outbox。
