# Chat Composer 重构架构与开发指南

> 状态：第一阶段重构已落地，兼容迁移仍在进行中。
>
> 适用范围：`packages/dmworkbase` 聊天输入框、发送编排、附件、草稿、快捷键、粘贴和消息渲染扩展。
>
> 本文档定义目标架构、稳定接口、扩展机制和迁移顺序。每个迁移 PR 都必须保持现有用户行为，除非 PR 明确声明并验证行为变化。

当前实现已经落地：

- `ChatSendRequest`、`ChatSendOutcome`、`ComposeAttemptLedger` 和纯函数发送计划。
- operation 级 transport/executor，以及统一的 settle 顺序。
- attempt ID 草稿所有权；草稿清理发生在编辑器恢复/释放之后。
- 编辑器销毁或切换频道时的可观察、有限容量 recovery store。
- 公开的 pending-send renderer registry 和 transport operation registry。
- editor compose part registry；附件节点已迁移 capture/restore/dispose，并显式映射到现有 image/file 发送模型。
- `ChatComposerAttachmentStore`；顶部附件使用 snapshot/take/restore，inline 附件使用 live/leased/handoff 转移所有权，React 只订阅列表快照。

仍需后续迁移：

- 继续迁移 text/mention capture、Tiptap port、keyboard 和 clipboard policy。
- 把通用 `ComposePart`/extension operation 纳入现有兼容 request，而不是继续增加字段分支。
- 将 Conversation 中的上传预检和 SDK content 构造进一步下沉到 bridge adapter。

## 1. 背景

当前聊天输入框已经具备 Tiptap 编辑器、mention、emoji、slash command、顶部附件、编辑器内附件、RichText 混排、语音输入、草稿恢复和连续发送等能力。

主要实现集中在：

- `packages/dmworkbase/src/Components/MessageInput/index.tsx`
- `packages/dmworkbase/src/Components/MessageInput/sendFlow.ts`
- `packages/dmworkbase/src/Components/MessageInput/composeConsume.ts`
- `packages/dmworkbase/src/Components/Conversation/index.tsx`

当前问题不是单纯的文件过大，而是一次发送的生命周期跨越多个所有者：

```text
MessageInput
  -> 读取 Tiptap 文档和附件
  -> 同步清空输入框
  -> 维护 pending send 和恢复偏移
  -> 调用 Conversation.onSend

Conversation
  -> 决定 text / attachment / RichText mixed 路径
  -> 执行上传和消息入队
  -> 等待 upload / ack
  -> 清理远端草稿
  -> 返回部分发送结果

MessageInput
  -> 解释发送结果
  -> 恢复或释放编辑器内容、附件、reply/edit target
```

这会导致以下风险：

- pending send、队列和草稿清理之间依赖隐含时序。
- `void | boolean | SendResultDetail` 无法直观表达“未入队、部分入队、已入队但 ack 失败”。
- 编辑器文档、发送协议和渲染组件互相知道过多细节。
- 新增一种可编辑、可发送、可预览的内容节点时，需要修改多处核心分支。
- Chat 与 Docs 评论输入框容易因为“看起来都用 Tiptap”而被错误地强行统一。

## 2. 设计目标

### 2.1 必须满足

- 保持现有消息协议和接收端渲染兼容。
- 保持 consume-first / restore-on-failure 行为。
- 明确区分 `enqueued` 和 `acked`。
- 连续发送、部分失败、切换会话和编辑器销毁时不丢内容、不重复发送。
- 输入框 UI 不直接理解 WuKongIM SDK、上传协议或消息 ack。
- Conversation 不直接操作 Tiptap 文档和输入框内部附件状态。
- 新增编辑器节点或消息类型时，通过注册扩展完成，不修改主发送循环和主渲染组件。
- 支持独立测试编辑器捕获、发送计划、传输执行、settle 和渲染。

### 2.2 非目标

- 不切换回 textarea。
- 不在本轮启用完整 WYSIWYG。
- 不让聊天输入框和评论输入框共享同一个 React 组件。
- 不建立包含所有场景开关的通用 `ComposerCapabilities` 框架。
- 不把 Tiptap JSON 定义成跨模块公共协议。
- 不在一个 PR 中同时完成行为修复、目录迁移和视觉改版。

## 3. 架构原则

### 3.1 发送是事务，不是回调

一次发送必须拥有稳定 ID，并按以下状态推进：

```text
draft
  -> captured
  -> queued
  -> pre_enqueue
  -> enqueued | partially_enqueued | not_enqueued
  -> settled
```

所有恢复、附件释放、reply/edit target 恢复和草稿清理，都由同一个 attempt 的 settle 决策触发。

### 3.2 编辑器模型、发送模型、消息模型分离

- 编辑器模型：Tiptap JSON 和 NodeView，只服务编辑体验。
- 发送模型：标准化 `ComposePart` 和 `ChatSendPlan`，只服务发送事务。
- 消息模型：WuKongIM `MessageContent` 和接收侧 renderer，只服务 wire protocol 与历史消息展示。

三者允许映射，但不得直接互相替代。

### 3.3 扩展通过注册表进入

核心流程不应出现不断增长的：

```ts
if (node.type === "image") { ... }
else if (node.type === "file") { ... }
else if (node.type === "card") { ... }
```

节点捕获、恢复、发送操作构建和预览渲染由扩展描述符注册。

### 3.4 行为优先于目录

先建立测试和稳定接口，再移动文件。不能为了得到整齐目录而同时重写发送语义。

## 4. 目标模块结构

新代码放在 `features/`，避免继续扩大 `Components/MessageInput`：

```text
packages/dmworkbase/src/features/chat-composer/
  domain/
    types.ts
    sendOutcome.ts
    composeAttemptLedger.ts
    draftCoordinator.ts
    extensionRegistry.ts

  editor/
    composePartRegistry.ts
    createChatEditorExtensions.ts
    tiptapEditorPort.ts
    captureEditorDocument.ts
    restoreEditorParts.ts
    keyboardPolicy.ts
    clipboardPipeline.ts
    extensions/
      textExtension.ts
      mentionExtension.ts
      attachmentExtension.ts

  submission/
    captureComposeAttempt.ts
    buildChatSendPlan.ts
    settleComposeAttempt.ts
    chatSendQueue.ts

  bridge/
    ChatTransportPort.ts
    executeChatSendPlan.ts
    waitForMessageEnqueue.ts
    waitForMessageAck.ts

  recovery/
    composeRecoveryStore.ts

  ui/
    ChatComposer.tsx
    ChatComposerView.tsx
    AttachmentTray.tsx
    PendingComposePreview.tsx
    ComposerToolbar.tsx
    renderRegistry.tsx

  __tests__/
    composeAttemptLedger.test.ts
    buildChatSendPlan.test.ts
    executeChatSendPlan.test.ts
    clipboardPipeline.test.ts
    keyboardPolicy.test.ts
```

迁移期间保留：

```text
Components/MessageInput/index.tsx
```

它作为兼容入口重新导出或装配新的 `ChatComposer`，直到所有调用方迁移完成。

## 5. 分层职责

### 5.1 Domain

Domain 层不依赖 React、Tiptap、Semi UI、WKApp 或 WuKongIM SDK。

负责：

- compose attempt 状态。
- 标准化 part 和 send outcome。
- pending attempt 顺序。
- 草稿所有权。
- 扩展描述符的纯数据接口。

不得负责：

- DOM 事件。
- Toast 或 Notification。
- 文件上传。
- Tiptap command。
- 消息气泡渲染。

### 5.2 Editor

Editor 层是 Tiptap adapter。

负责：

- 创建聊天输入框 extension 集合。
- 把 Tiptap 文档捕获为 `ComposePart[]`。
- 把未发送 part 恢复为 Tiptap 节点。
- clipboard handler 的执行顺序。
- keyboard policy 与 suggestion plugin 的边界。

### 5.3 Submission

Submission 层负责一次发送事务在客户端的生命周期。

负责：

- 同步 capture 和 consume。
- 建立 `ComposeAttempt`。
- 排队执行。
- 根据 `ChatSendOutcome` settle。
- 释放或恢复附件资源。

Submission 不调用 SDK，实际传输通过 `ChatTransportPort` 完成。

### 5.4 Bridge

Bridge 层适配现有 Conversation、SDK、上传和消息状态。

负责：

- 上传前检查。
- 媒体上传。
- 创建 SDK `MessageContent`。
- 入队消息。
- 等待 ack 以维持消息顺序。
- 将 SDK 结果转换为 `ChatSendOutcome`。

### 5.5 UI

UI 层只渲染 controller 暴露的状态和动作。

负责：

- EditorContent 容器。
- 附件托盘。
- 工具栏。
- expanded 状态。
- pending preview。
- 错误状态展示。

UI 不构造发送 payload，不读取 SDK 状态，不维护草稿所有权。

## 6. 核心数据模型

### 6.1 ComposePart

`ComposePart` 是编辑器和发送计划之间的稳定边界。

```ts
export interface ComposePartBase {
  id: string
  kind: string
  version: number
}

export interface TextComposePart extends ComposePartBase {
  kind: "text"
  text: string
  restoreText: string
  mention?: MentionPayload
}

export interface AttachmentComposePart extends ComposePartBase {
  kind: "attachment"
  attachmentId: string
  placement: "inline" | "top"
  mediaKind: "image" | "video" | "file"
  file: File
}

export interface ExtensionComposePart<TPayload = unknown> extends ComposePartBase {
  kind: `extension:${string}`
  payload: TPayload
}

export type ComposePart<TPayload = unknown> =
  | TextComposePart
  | AttachmentComposePart
  | ExtensionComposePart<TPayload>
```

要求：

- 每个 part 必须有稳定 ID。
- `restoreText` 保留 mention marker 等可恢复信息，不能只保留展示文本。
- `previewText` 和 `draftText` 必须分开生成。
- extension payload 必须包含版本号，并由对应扩展负责运行时校验。

### 6.2 ComposeAttempt

```ts
export interface ComposeAttempt {
  id: string
  createdAt: number
  editorSnapshot: unknown
  parts: ComposePart[]
  previewText: string
  draftText: string
  target?: SendTargetSnapshot
  draftBaseline: DraftBaseline
  expandedAtCapture: boolean
}
```

`editorSnapshot` 仅由 editor adapter 使用，不能传给 transport。

### 6.3 ChatSendRequest

```ts
export interface ChatSendRequest {
  attemptId: string
  parts: ComposePart[]
  target?: SendTarget
  progress: SendProgressReporter
}
```

替代当前多位置参数 `onSend(text, mention, attachments, topFiles, editorBlocks, ...)`。

### 6.4 ChatSendOutcome

```ts
export type ChatSendOutcome =
  | {
      kind: "not_enqueued"
      reason: SendFailureReason
    }
  | {
      kind: "enqueued"
      consumedPartIds: string[]
      unsentParts: ComposePart[]
      restoreTarget: boolean
    }
```

规则：

- `not_enqueued`：没有本地气泡，所有内容必须恢复。
- `enqueued`：至少一个操作已产生本地气泡。
- ack 超时或服务器拒绝发生在入队之后时，仍返回 `enqueued`，失败状态由消息气泡承载。
- 部分失败通过 `unsentParts` 精确恢复。
- 不允许使用 `boolean` 表达该语义。

## 7. Compose Attempt Ledger

`ComposeAttemptLedger` 是 pending send 的唯一事实源。

```ts
export interface ComposeAttemptLedger {
  capture(attempt: ComposeAttempt): void
  markExpectedParts(attemptId: string, count: number): void
  markPartEnqueued(attemptId: string): void
  settle(attemptId: string, outcome: ChatSendOutcome): LedgerSettlement
  remove(attemptId: string): void
  orderedPending(): ComposeAttempt[]
  pendingDraftText(): string
  pendingPreEnqueueCount(): number
}
```

关键约束：

- attempt 必须在队列允许下一项执行前完成 settle 和 remove。
- 草稿逻辑通过 attempt ID 判断所有权，不能比较文本内容。
- 两条内容相同的消息仍然是不同 attempt。
- attachment-only attempt 不能消费下一条文本草稿。
- ledger reducer 必须是纯函数或可通过纯状态测试驱动。

推荐队列结构：

```ts
queue.enqueue(async () => {
  try {
    const outcome = await executeChatSendPlan(request)
    return settleComposeAttempt(attempt, outcome)
  } finally {
    ledger.remove(attempt.id)
  }
})
```

`remove` 必须在 task promise settle 前运行，避免下一项看到已经完成的旧 attempt。

## 8. 草稿模型

草稿需要区分三种表示：

```text
previewText  用户可见的发送中预览，例如 @Alice
draftText    可恢复的 canonical 文本，例如 @[uid:Alice]
sendText     最终 wire 文本及 mention sidecar
```

禁止用一个字符串同时承担三种职责。

`DraftCoordinator` 维护：

```ts
type DraftOwner =
  | { kind: "live" }
  | { kind: "pending"; attemptIds: string[] }
  | { kind: "empty" }
```

规则：

- live editor 内容始终优先。
- 编辑器为空且存在 pre-enqueue attempt 时，持久化 ordered pending `draftText`。
- attempt 入队后，只移除该 attempt 对应的草稿片段。
- 不通过字符串相等判断草稿归属。
- canonical draft 不携带内部 trust mark，恢复 mention 时继续 fail-closed。

### 8.1 跨编辑器恢复

发送期间切换频道会销毁原 Tiptap editor。尚未入队的 compose 不能继续回写旧 editor，必须转移到按频道存储：

```text
old MessageInput settle failure
  -> ComposeRecoveryStore.add(channelKey, attempt)
  -> notify active Conversation subscriber
  -> restore latest persisted/live draft first
  -> prepend failed attempts in arrival order
  -> consume recovery records without disposing transferred resources
```

当前存储策略：

- session 内存级，不使用 `Conversation` 实例静态字段。
- 每频道最多 20 条，最多 50 个频道，TTL 30 分钟。
- attempt ID 去重，多个失败 attempt 按到达顺序恢复。
- 正常恢复表示 `File` 和 object URL 所有权已转移给新 editor，不执行 dispose。
- recovery callback 必须同步返回是否已接管记录；未接管或抛错时旧 composer 立即释放资源。
- TTL、容量淘汰会显式释放尚未转移的 object URL；document unload 由浏览器回收。
- recovery 只在 reply/edit target 为空时恢复目标，用户更新的选择始终优先。
- 远端草稿和 live draft 先恢复，失败 compose 再前置合并；禁止因 recovery 存在而跳过新草稿。

当前不把 recovery `File` 写入 IndexedDB。页面重载后原发送任务和 settle 上下文已经终止，单独持久化文件会引入存储配额、权限、版本迁移和孤儿 Blob 清理问题。文本草稿继续走现有远端 draft；如果后续产品要求“浏览器崩溃后恢复附件”，应作为独立的 durable outbox 设计，而不是扩展当前临时 recovery store。

## 9. 发送计划

`buildChatSendPlan()` 是纯函数，输入 `ChatSendRequest`，输出明确的操作序列：

```ts
export interface ChatSendPlan {
  attemptId: string
  operations: ChatSendOperation[]
}

export type ChatSendOperation =
  | { kind: "edit_text"; partIds: string[]; content: TextPayload }
  | { kind: "send_text"; partIds: string[]; content: TextPayload }
  | { kind: "send_media"; partIds: string[]; attachment: AttachmentComposePart }
  | { kind: "send_rich_text"; partIds: string[]; blocks: RichTextBlock[] }
  | { kind: "send_extension"; partIds: string[]; extensionId: string; payload: unknown }
```

计划构建规则：

- text + image 且不含普通文件时，可聚合为一条 RichText operation。
- top image 被聚合后不能再次生成独立 media operation。
- reply/edit target 在 capture 时确定，不能在队列执行时读取 live VM。
- 每个 operation 都必须声明消费的 part ID。
- executor 只报告 operation 是否入队，settle 层再计算哪些 part 需要恢复。

## 10. 渲染扩展架构

渲染扩展分成三层，不能使用同一个 React renderer 覆盖所有阶段。

### 10.1 编辑器节点渲染

负责编辑中的节点、NodeView、捕获和恢复。

```ts
export interface ComposerEditorExtension<TPayload> {
  id: string
  version: number
  tiptapExtensions(): Extension[]
  capture(node: JSONContent, context: CaptureContext): ComposePart<TPayload> | null
  restore(part: ComposePart<TPayload>, context: RestoreContext): JSONContent[]
}
```

例如 attachment 扩展负责：

- 注册 `AttachmentNode`。
- 把 attachment node 转为 `AttachmentComposePart`。
- 部分失败时恢复 node。
- 管理 File 引用和 preview URL 生命周期。

### 10.2 输入框和 pending preview 渲染

负责顶部附件区、发送中预览、失败恢复提示等即时 UI。

```tsx
export interface ComposerPartRenderer<TPayload> {
  extensionId: string
  renderInline?(part: ComposePart<TPayload>): React.ReactNode
  renderTray?(part: ComposePart<TPayload>): React.ReactNode
  renderPending?(part: ComposePart<TPayload>): React.ReactNode
}
```

`ChatComposerView` 只根据 registry 查 renderer：

```tsx
const renderer = renderRegistry.get(part.kind)
return renderer?.renderPending?.(part) ?? <UnsupportedPendingPart />
```

新增节点不修改 `ChatComposerView` 主分支。

### 10.3 接收消息渲染

历史消息渲染继续由消息内容类型和现有消息 renderer 体系负责，不复用 composer renderer。

```ts
export interface MessageRenderExtension<TContent extends MessageContent> {
  contentType: number
  decode(payload: unknown): TContent
  render(content: TContent, context: MessageRenderContext): React.ReactNode
}
```

原因：

- 编辑节点可能包含本地 `File` 和 blob URL，历史消息只包含远端 payload。
- pending 状态包含上传和恢复动作，历史消息包含 resend、reply 和权限状态。
- 两者视觉可以共享小型 UI 组件，但不能共享生命周期组件。

### 10.4 完整扩展注册

新增一个可编辑且可发送的内容类型时，提供独立扩展包：

```text
extensions/location/
  editorExtension.ts
  sendExtension.ts
  composerRenderer.tsx
  messageRenderer.tsx
  schema.ts
  __tests__/
```

注册示例：

```ts
composerExtensionRegistry.register(locationEditorExtension)
sendExtensionRegistry.register(locationSendExtension)
composerRenderRegistry.register(locationComposerRenderer)
messageRenderRegistry.register(locationMessageRenderer)
```

当前迁移阶段的 pending UI 已通过
`features/chat-composer/ui/chatPendingComposeRenderRegistry.tsx` 暴露应用级 registry。
附件预览是第一个注册 renderer，扩展可以注册更高优先级的 renderer 接管匹配项，
`MessageInput` 不再持有私有单例。

发送执行通过 `ChatSendOperationRegistry` 装配。内建 text/edit/media/RichText
和外部 `extension:*` operation 使用同一分发机制；应用层把 registry 传给
`ConversationChatTransportHandlers.operationRegistry` 即可增加 operation，不修改 bridge。
旧 `operationHandlers` 只保留为内建 operation 覆盖兼容层。

editor 层已提供 `chatEditorComposePartRegistry`，附件是第一个生产扩展，负责节点
capture、部分失败 restore、`File` 引用和 object URL dispose。当前 registry 的
`toSendBlock` 只接受映射到既有 image/file 发送模型的原子节点；没有该 adapter 的 part
会在编辑器清空前 fail-closed。`UnsentEditorBlock` 仍只标准化 text/attachment，因此
自定义 wire payload 尚未形成 editor capture → operation → settle → recovery 的完整闭环。
不能只注册 `extension:*` operation 就宣称新 editor part 已可安全发送。

text/mention capture、Tiptap port 和历史消息 renderer 仍需后续迁移，不能把当前
editor/operation/pending registry 误认为已经完成全部插件化。

扩展注册必须发生在应用装配层，domain 不允许 import 具体扩展。

### 10.5 未知扩展降级

当前迁移阶段：

- 已注册但没有 settlement adapter 的 editor part：发送前拒绝消费，保留原编辑器内容。
- capture 后 owning extension 被注销：已 capture part 继续使用原 extension 的生命周期租约；
  无租约的重建 part 则抛出可诊断错误，不再静默使用原始 node 或跳过资源释放。
- 重复 part ID：capture 直接失败，避免后续 Map 覆盖错误 part。

目标架构仍需补齐：

- 编辑器恢复遇到版本未知但有持久化 fallback 的 part：恢复成可见文本占位，不静默丢弃。
- pending preview 遇到未知 part：展示统一 unsupported 状态。
- send plan 遇到未知 extension：返回 `not_enqueued`，保留整个 attempt。
- 接收消息遇到未知 content type：沿用现有未知消息降级策略。

## 11. Clipboard Pipeline

clipboard handler 使用明确优先级：

```text
secret guard
  -> Octo RichText payload
  -> external HTML link conversion
  -> image / file paste
  -> plain text fallback
```

接口：

```ts
export interface ClipboardHandler {
  id: string
  priority: number
  handle(context: ClipboardContext): ClipboardResult
}

type ClipboardResult =
  | { handled: true }
  | { handled: false }
```

要求：

- secret guard 永远最高优先级。
- HTML 使用 `DOMParser`，禁止正则解析 HTML。
- 外部 `<a href>` 仅保留安全 http/https URL，并转换为 Markdown source text。
- 不恢复 Tiptap autolink。
- `README.md`、`xxx.md` 保持普通文本。

## 12. Keyboard Policy

键盘行为采用两层策略，不建立一个接管全部 ProseMirror keymap 的巨大状态机。

### Suggestion 层

mention 和 emoji plugin 负责：

- ArrowUp / ArrowDown。
- 普通 Enter 选择候选项。
- Escape 关闭候选项。
- Shift+Enter 必须返回 false，让 Tiptap HardBreak 处理。

### Composer 层

`keyboardPolicy.ts` 负责：

```ts
type ComposerKeyAction =
  | "pass"
  | "submit"
  | "slash_select"
  | "slash_close"
  | "alt_action"
```

优先级：

1. IME composing：`pass`。
2. suggestion active：`pass` 给 suggestion plugin。
3. slash menu：处理选择、关闭和导航。
4. Alt+Enter：`alt_action`。
5. Enter 且非 Shift：`submit`。
6. Shift+Enter：`pass` 给 Tiptap HardBreak。

## 13. ChatTransportPort

当前第一阶段使用 operation 级窄接口，避免把 SDK 类型泄漏到 domain 和
submission：

```ts
export interface ChatTransportResult {
  enqueuedPartIds: string[]
  messageId?: string
}

export interface ChatTransportPort<TMessage = unknown> {
  execute(operation: ChatSendOperation<TMessage>): Promise<ChatTransportResult>
}
```

`executeChatSendPlan()` 按 plan 顺序串行调用 port，并保留每个 operation 的成功、
部分入队和异常结果。Conversation 适配器内部可以继续拆成
`precheckAttachment`、`uploadAttachment`、`enqueue`、`edit` 和 ack 等步骤，但这些
步骤不应成为 composer 的公共协议。

语义：

- operation 成功返回的 `enqueuedPartIds` 必须是该 operation 声明的 part ID 子集，且不能重复。
- 入队成功后，composer 视为已消费；ack 超时或服务端失败不应恢复已入队 part。
- operation 失败不阻断后续 operation，settle 层根据结果精确恢复未入队 part。
- Toast 和通知由 bridge/UI 错误呈现层处理，domain 不依赖 UI。

## 14. Chat 与评论输入框的复用边界

Chat Composer 和 Docs `MentionComposer` 不共享完整组件或发送模型。

允许共享：

- Tiptap voice target adapter。
- 安全 URL 校验。
- selection 和 replace range 类型。
- suggestion 键盘辅助函数。
- 通用 mention candidate 接口。

不共享：

- mention token codec。Chat 和 Docs 的持久化格式不同。
- attachment store。
- ChatSendPlan。
- 草稿 ledger。
- submit shortcut 配置对象。
- React composer shell。

语音输入建议抽取：

```ts
export interface VoiceInsertTarget {
  getText(): string
  getSelection(): SelectionRange | null
  replaceAll(text: string): void
  replaceSelection(text: string): void
  insertAtCursor(text: string): void
  focus(): void
}
```

Chat 和 `MentionComposer` 各自实现 adapter。

## 15. 迁移计划

### PR 1：生命周期基线

范围：

- 增加 queued send + provisional draft 集成测试。
- 修正上一 attempt 尚未 remove 时下一任务启动的问题。
- 拆分 `previewText` 和 canonical `draftText`。
- pending 草稿保留 mention 结构和换行。

不做：

- 不移动 UI 文件。
- 不修改消息 payload。

### PR 2：稳定发送契约

范围：

- 引入 `ComposeAttempt`、`ChatSendRequest`、`ChatSendOutcome`。
- 将位置参数改为单对象参数。
- 内部移除 `void | boolean` 结果。
- 兼容 adapter 只保留在旧入口边界。

### PR 3：Attempt Ledger

范围：

- 引入 `ComposeAttemptLedger`。
- 收口 pending count、pending preview、draft ownership 和 restore offset。
- 删除散落的 pending refs。

### PR 4：发送计划和 executor

范围：

- 提取 `buildChatSendPlan()`。
- 提取 `executeChatSendPlan()`。
- 为 text、top attachment、inline attachment、RichText mixed、reply、edit 和部分失败补齐测试。
- `Conversation` 只提供 transport port 和消息上下文。

### PR 5：Editor 与附件拆分

范围：

- 提取 editor port、attachment store、capture 和 restore。
- `MessageInput/index.tsx` 变为兼容装配层。
- 显式关闭列表 extension。

当前进度：

- `ComposeEditorPort`、editor compose part registry 和 attachment capture/restore 已提取。
- `ChatComposerAttachmentStore` 已替代 `attachmentFilesRef`、`topAttachmentsRef` 及其双写逻辑。
- 顶部附件在发送时先 snapshot，editor 成功清空后再按 ID take；失败 restore 和 recovery
  通过同一 store 去重回插，避免同步异常提前移走附件。
- inline `File` 与 preview URL 已合并为 store 资源：发送时 leased，失败恢复时转回 live，
  成功时统一 dispose，editor 销毁时无 revoke 地 handoff 给 recovery。

### PR 6：Clipboard 与 Keyboard

范围：

- 建立 clipboard pipeline。
- 修复外部 HTML link paste。
- 提取 keyboard policy。
- 增加 IME、slash、mention、emoji、Shift+Enter 组合测试。

### PR 7：渲染扩展注册

范围：

- 引入 editor、send、composer render registry。
- 先迁移 attachment 作为参考扩展。
- 保持现有 message renderer 不变，仅增加明确适配边界。

### PR 8：评论语音 adapter

范围：

- 提取 Tiptap voice target adapter。
- Chat 保持行为不变。
- Docs `MentionComposer` 接入语音输入。

## 16. 测试策略

### 16.1 Domain 单测

- attempt 状态迁移。
- 相同文本的两个 attempt 不混淆。
- A/B 连续发送的 settle 和 remove 顺序。
- attachment-only attempt 不消费后续文本草稿。
- 部分入队仅恢复未发送 part。

### 16.2 Real Tiptap 测试

- capture 后同步清空。
- restore 保留 mention、hardBreak、段落和 attachment ID。
- 新草稿不会被失败 attempt 覆盖。
- 远端草稿与跨编辑器 recovery 同时存在时，恢复顺序为失败 attempt、最新草稿。
- recovery 到达已挂载的新 Conversation 时能触发恢复。
- 新 reply/edit target 不被旧 recovery 覆盖。
- extension part 可以 capture、restore 和降级。

### 16.3 Send executor 测试

- text 入队。
- media precheck 失败。
- upload 后入队。
- ack timeout 不恢复 composer。
- mixed payload 不重复消费顶部图片。
- 一个附件失败时只恢复该附件。
- reply/edit target 随 attempt 固定。

### 16.4 Clipboard 测试

- secret paste 硬阻断。
- Octo RichText 优先于普通 HTML。
- `<a href>` 转 Markdown，并过滤不安全 URL。
- `README.md` 不触发链接。
- 图片和文件 fallback。

### 16.5 浏览器测试

jsdom 无法可靠模拟所有 IME 和系统 clipboard 行为，以下场景需要浏览器测试：

- 中文输入法 Enter 上屏不发送。
- mention/emoji 弹层打开时 Shift+Enter 换行。
- HTML 链接从真实网页复制后保留 URL。
- 快速连续发送三条文本和三张图片。
- 发送 pre-enqueue 阶段切换会话。
- 暗色模式、expanded 模式和长文本布局。

## 17. 验收标准

重构完成后应满足：

- `MessageInput` 不再包含上传、ack、消息协议和草稿所有权逻辑。
- `Conversation` 不再读取 Tiptap 文档或操作输入框附件状态。
- 每次发送都有 attempt ID，所有恢复和释放都可追踪到该 ID。
- 内部发送 API 不再返回裸 boolean。
- 新增一个 extension part 不需要修改 ChatComposer 主渲染分支或发送循环。
- editor、send plan、executor 和 settle 可以独立测试。
- 现有 MessageInput 测试和 Docs 评论测试继续通过。
- 手工验证连续发送、失败恢复、reply/edit、草稿、IME 和链接粘贴。

## 18. 风险控制

- 每个 PR 只迁移一个所有权边界。
- 纯提取 PR 不同时改变用户行为。
- 行为修复必须先有失败测试。
- 旧入口在迁移期保留 adapter，所有调用方迁移后再删除。
- 不以减少行数作为验收标准，以所有权、接口和可测试性作为标准。
- 新 extension 首先迁移现有 attachment，证明注册机制足够后再开放给新类型。

## 19. 开发检查清单

- 是否明确本 PR 改变的是 capture、plan、execute 还是 settle？
- 是否保持 `enqueued != acked`？
- 是否有 attempt ID，而不是通过文本比较归属？
- 是否说明失败后哪些 part 恢复、哪些保持消费？
- 是否保持 mention fail-closed？
- 是否为新增 part 提供 editor、send 和 renderer 扩展？
- 是否提供未知扩展的降级行为？
- 是否覆盖连续发送和切换会话？
- 是否没有把 SDK、WKApp 或 Toast 引入 domain/UI 层？
- 是否给出可复现的测试命令和手工路径？
