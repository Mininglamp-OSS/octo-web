# Chat Composer 架构指南

本文描述 `packages/dmworkbase/src/features/chat-composer` 的当前生产架构、稳定边界和扩展方式。
它不是重构过程记录；历史决策以代码、测试和 Git 历史为准。

## 1. 生产调用链

聊天页面仍由 `Components/Conversation` 负责装配，输入、消费、排队、发送计划和恢复逻辑位于
`features/chat-composer`。

```text
Conversation composition root
  -> createDefaultChatComposerExtensions()
  -> ChatComposer / Tiptap
  -> ChatComposerCoordinator.submit()
  -> ChatComposerController serial queue
  -> createConversationChatSendHandler()
  -> buildChatSendPlan()
  -> executeChatSendPlan()
  -> ConversationChatTransport
  -> settleChatSendExecution()
  -> settleConsumedCompose()
  -> consume, restore, or ComposeRecoveryStore
```

一次发送由稳定的 `attemptId` 贯穿 capture、consume、queue、transport、settle 和 recovery。
`Conversation` 提供 channel、reply target、远端草稿、上传和 SDK 能力，但不读取 Tiptap 文档，
也不直接操作 composer 附件 store。

## 2. 目录职责

```text
features/chat-composer/
  index.ts                         公共入口
  voice.ts                         轻量语音入口

  domain/
    types.ts                       request、outcome、settlement、send result
    sendPlan.ts                    operation 与 plan DTO
    composeAttemptLedger.ts        pending attempt 唯一事实源
    editorCompose.ts               editor capture 中间模型
    mentionMarker.ts               mention canonical marker

  application/
    ChatComposerCoordinator.ts     capture -> consume -> send -> settle 协调
    ChatComposerController.ts      串行队列、pending 和 restore prefix
    composeConsume.ts              editor/附件消费与恢复
    buildChatSendPlan.ts           纯发送计划构建
    executeChatSendPlan.ts         operation 串行执行
    settleChatSendExecution.ts     transport result -> outcome
    sendFlow.ts                    settle 与恢复策略

  ports/                           editor、host、view、transport 边界
  adapters/conversation/           Conversation、SDK、上传和 reply adapter
  adapters/tiptap/                 Tiptap 节点、mention、emoji
  adapters/voice/                  语音输入 adapter
  editor/                          附件 store 与 compose part registry
  extensions/                      editor/send/pending 扩展 bundle
  recovery/                        跨实例恢复和草稿 revision
  clipboard/                       粘贴解析与 secret guard
  keyboard/                        Enter、IME、suggestion 策略
  ui/                              ChatComposer 和纯 UI
```

依赖方向：

```text
UI -> Application -> Domain
UI -> Ports <- Conversation Adapter -> SDK/Application Services
```

`domain` 和 `application` 不应依赖 React、Tiptap、WKApp 或 WuKongIM SDK。

## 3. 发送事务

### 3.1 提交前

`ChatComposer.send()` 在消费 editor 前完成：

- editor ready 和消息长度检查；
- editor part capture 与 schema/runtime validation；
- text、mention、top attachments 和 ordered editor blocks 提取；
- host 可用性和空 compose 检查。

拒绝时返回 `ChatComposerSendRejection`，`editorConsumed` 必须为 `false`，原输入保持不变。

### 3.2 Capture 与 Consume

通过预检后，coordinator 在第一次 `await` 之前：

1. 捕获 channel、reply target、draft revision 和 expanded 状态；
2. 分配 `attemptId`；
3. 同步 take editor 内容和附件；
4. 清空当前 compose；
5. 将 attempt 加入 controller 和串行队列。

因此用户可以在上一条消息上传或等待 ack 时继续输入。后续发送捕获独立快照，不读取前一个
attempt 的可变状态。

### 3.3 Plan、Transport 与 Settle

`buildChatSendPlan()` 将 compose 转成 operation：

- `send_text`
- `send_media`
- `send_rich_text`
- 已注册的扩展 operation

`executeChatSendPlan()` 串行执行 operation，并记录每个 part 是否已经本地入队。Transport 必须
通过 `onEnqueued(partIds)` 上报入队事实，不能用服务端 ack 代替。

settlement 根据 part ID 决定：

- 已入队内容保持消费；
- 未入队内容精确恢复；
- 已消费资源释放；
- editor 已卸载时转交跨实例 recovery。

前一个 attempt 完成 settlement、资源移交和 ledger 清理后，队列才执行下一个 attempt。

## 4. 内容与资源所有权

### 4.1 文本

```text
previewText  pending UI 展示文本，例如 @Alice
draftText    可恢复 canonical 文本，例如 @[uid:Alice]
sendText     wire 文本和 mention sidecar
```

三者不能由同一个字符串隐式承担。草稿清理按 `attemptId + revision` 判断，不能根据文本相同
推断所有权。

### 4.2 附件

- top attachments 使用 snapshot/take/restore 转移所有权；
- inline attachments 使用 live/leased/handoff 生命周期；
- object URL 由当前 owner 或 recovery store 释放；
- 部分成功只释放已消费 part，未发送 part 按原 ID 恢复。

附件 store 与 editor 属于同一个 ChatComposer 实例。实例卸载后禁止把附件恢复到旧 store，必须
交给 `ComposeRecoveryStore`。

如果只有 top attachment 恢复失败，recovery record 必须携带空 editor snapshot，不能把已经发送
的正文或 inline 资源重新放回输入框。

## 5. 跨实例 Recovery

```text
old coordinator settlement
  -> ComposeRecoveryStore.add(channelKey, record)
  -> active Conversation claims channel records
  -> ChatComposer batch preflight
  -> reconcile reply target
  -> hydrate editor and attachment store
  -> acknowledge attempt IDs and persist canonical draft
```

关键规则：

- recovery 以 batch 为所有权单位；任一记录无法构建或资源 ID 冲突，整批不 hydrate、不确认；
- reply target 协调发生在任何 editor 或附件 mutation 之前；
- 只有 batch 中所有记录的 target 状态一致时才恢复该 target；不同 target、targeted/targetless
  混合均视为 neutral recovery；
- 当前宿主已有不同的新 reply target 时，reconciliation 返回失败，整批保留在 store，不能覆盖
  新 target，也不能提前 acknowledge；
- 同一 target 当前按 `handlerType + replyMessage` 对象引用判等。重新实例化会被保守视为冲突，
  只会延迟恢复，不会误发送或丢失 recovery；
- 连续失败恢复使用实际 editor marker 和 top attachment ID 前缀校验顺序。用户删除、替换或重新
  消费恢复节点后，旧 offset 自动失效。

Recovery 是 session 内存级能力，不写入 IndexedDB，也不承诺浏览器崩溃或刷新后的附件恢复。
远端草稿写入由 `ComposeDraftWriteQueue` 按 channel 串行，避免旧实例写入覆盖新实例 hydration。

## 6. 扩展模型

composition root 为每个 Conversation 实例创建一次扩展 bundle：

```ts
const extensions = createDefaultChatComposerExtensions<Message>();

<ChatComposer extensions={extensions} />;

const send = createConversationChatSendHandler(host, {
  operationRegistry: extensions.send.operations,
});
```

同一 bundle 包含：

- `editor.composeParts`：capture、restore、dispose、toSendBlock；
- `editor.tiptap`：Tiptap extensions；
- `send.operations`：operation handlers；
- `render.pending`：发送中 preview renderer。

新增可发送 editor part 必须形成完整闭环：

```text
schema validation
  -> Tiptap node and compose part adapter
  -> stable part ID
  -> send block and operation handler
  -> settlement/recovery mapping
  -> pending renderer
  -> focused tests
  -> production registration
```

约束：

- part ID 在一个 editor document 内全局唯一，capture 期间不能临时生成新 ID；
- payload 在 consume 前必须可 `structuredClone`，handler 仍需做 runtime validation；
- 自定义 operation 默认不接收 reply target，只有 handler 能正确编码时才显式启用；
- 当前自定义 part 只支持 snapshot recovery；拥有独立 `File`、object URL 或外部 lease 的扩展，
  需要先提供 resource handoff contract；
- 只有发送 handler、没有 restore/dispose，不算完整扩展，预检必须 fail closed。

## 7. UI、Clipboard 与 Keyboard

常见 UI 改动边界：

| 需求               | 修改位置                          | 不应修改               |
| ------------------ | --------------------------------- | ---------------------- |
| 布局、颜色、工具栏 | `ui/ChatComposer.*`               | coordinator、transport |
| mention/emoji 面板 | `ui/suggestions/`、Tiptap adapter | draft、settlement      |
| pending preview    | pending render registry           | Conversation 分支      |
| 新节点外观         | Tiptap NodeView                   | SDK adapter            |
| 语音指示器         | `ui/voice/`                       | send contract          |

UI 必须保持 editor DOM 和 suggestion popup 生命周期稳定。Emoji/mention 选择应先完成 Tiptap
transaction，再关闭 popup；IME composing 时 Enter 不发送。

Clipboard 优先级：

```text
secret guard -> Octo RichText -> safe HTML links -> files/images -> plain text
```

Keyboard 优先级：

```text
IME -> active suggestion -> slash menu -> Alt+Enter -> Enter submit -> Shift+Enter
```

语音异步任务绑定启动时的 host、space 和 lifecycle epoch；host/space 变化、取消或卸载后，旧结果
不得写入新 composer。

## 8. Conversation 边界与公共入口

`Conversation` 可以：

- 创建实例级 extensions；
- 提供 channel、target、draft、上传、SDK、入队和 ack 能力；
- 持有跨 ChatComposer 实例的 recovery store；
- 通过 `createConversationChatSendHandler()` 适配发送事务。

`Conversation` 不得：

- 读取或修改 Tiptap JSON；
- 直接 take/restore composer attachment store；
- 绕过 ChatComposer 发送初始 compose；
- 在 queued attempt 执行时重新读取 live reply target；
- 根据文本内容猜测草稿或 recovery 所有权。

feature 外部代码从公共入口导入：

```ts
import {
  ChatComposer,
  createDefaultChatComposerExtensions,
  type ChatComposerSendResult,
} from "../../features/chat-composer";

import { useVoiceInput } from "../../features/chat-composer/voice";
```

生产代码不要从 `domain/`、`application/`、`ui/` 或 `recovery/` 深导入。

## 9. 验证

自动化验证：

```bash
pnpm --filter @octo/base test
pnpm --filter @octo/web build
```

涉及 UI、keyboard、clipboard、editor lifecycle 或 Conversation 装配时，至少手工验证：

1. 中文输入法候选期间按 Enter 不发送；确认后只发送一次；
2. mention、emoji 选择后 popup 一次关闭，不闪回；
3. 第一条消息等待上传或 ack 时继续发送第二条，内容和顺序正确；
4. 发送期间切换会话，失败内容只恢复到原 channel；
5. 部分发送成功时，只恢复失败正文或附件，不重复成功内容；
6. recovery batch 存在不同 reply target 时，不挂到任意一个旧 target；
7. 当前已有新 reply target 时，recovery 保留，直到 target 状态允许安全 hydration；
8. 文本、top/inline attachment、RichText 和已注册扩展均能发送与失败恢复。
