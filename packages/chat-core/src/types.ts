/**
 * @octo/chat-core — core chat primitive types
 *
 * Pure type/value definitions with no non-standard dependencies.
 */

/** Plain channel reference, compatible with WuKongIM Channel shape. */
export interface ChatChannelRef {
  channelId: string;
  channelType: number;
}

/**
 * Canonical string key for a channel, following WuKongIM's
 * `"${channelID}-${channelType}"` convention.
 */
export function chatChannelKey(channel: ChatChannelRef): string {
  return `${channel.channelId}-${channel.channelType}`;
}

/** Observable lifecycle status of a chat client. */
export enum ChatClientStatus {
  Idle = "idle",
  Connecting = "connecting",
  Connected = "connected",
  Disconnected = "disconnected",
  Failed = "failed",
  Stopped = "stopped",
}

/** Bootstrap parameters for starting a chat client. */
export interface ChatClientBootstrap {
  /** Endpoint for the chat connection (WebSocket URL, API origin, etc.). */
  readonly endpoint?: string;
  /** Authentication token or credential. */
  readonly token?: string;
  /** SDK-free session identifier (e.g. a login session ID or device token). */
  readonly session?: string;
  /** SDK-free space identifier (e.g. workspace or tenant ID). */
  readonly space?: string;
  /** Optional initial target metadata made available to the connection adapter. */
  readonly initialChannel?: ChatChannelRef;
}

/** Named events emitted by a ChatClient. */
export enum ChatClientEvent {
  StatusChanged = "statusChanged",
  ConversationOpened = "conversationOpened",
  ConversationClosed = "conversationClosed",
  Error = "error",
  /** Fired when a new message arrives for the active conversation. */
  MessageReceived = "messageReceived",
  /** Fired when a sent message's status changes. */
  MessageStatusChanged = "messageStatusChanged",
}

/** Snapshot of client state at a point in time. */
export interface ChatClientSnapshot {
  readonly status: ChatClientStatus;
  readonly activeConversation: ChatConversationLease | null;
}

/** Connection-scoped callbacks used by transport adapters. */
export interface ChatConnectionContext {
  /** Report an involuntary connection loss for this connection epoch. */
  onConnectionLost(): void;
  /** Report that this connection epoch has been restored. */
  onConnectionRestored(): void;
}

// ---------------------------------------------------------------------------
// Adapter interfaces  –  pluggable backends
// ---------------------------------------------------------------------------

/** Low-level connection lifecycle (WebSocket, long-poll, etc.). */
export interface ChatConnectionAdapter {
  readonly status: ChatClientStatus;
  connect(
    bootstrap: ChatClientBootstrap,
    context: ChatConnectionContext
  ): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Opaque handle returned by the conversation adapter's `openConversation`.
 *
 * The adapter may attach implementation-specific data here.
 * Consumers interact with the higher-level `ChatConversationLease` instead.
 */
export interface ChatConversationHandle {
  readonly channel: ChatChannelRef;
}

/**
 * Conversation lifecycle — adapter contract.
 *
 * `openConversation` returns an opaque handle.
 * The consumer's `ChatConversationLease` is managed by `ManagedChatClient`.
 */
export interface ChatConversationAdapter {
  openConversation(channel: ChatChannelRef): Promise<ChatConversationHandle>;
  closeConversation(handle: ChatConversationHandle): Promise<void>;
}

/** Optional channel-level event subscription (receive / typing / etc.). */
export interface ChatSubscribeAdapter {
  subscribe(channel: ChatChannelRef): Promise<void>;
  unsubscribe(channel: ChatChannelRef): Promise<void>;
}

// ---------------------------------------------------------------------------
// Message port — generic, SDK-free message contract
// ---------------------------------------------------------------------------

/** Direction bias for loading messages. */
export interface ChatMessageLoadOptions {
  older?: number; // load N messages before the anchor
  newer?: number; // load N messages after the anchor
  around?: number; // load N messages centered on the anchor
  anchor?: string; // message ID or seq to anchor around; omit = latest
}

/**
 * Generic message port — the single capability contract for message
 * I/O that consumers depend on.
 *
 * None of these types reference WuKongIM or any SDK class.
 * Adapters map between the SDK model and these generic values.
 */
export interface ChatMessagePort<
  TMessage = unknown,
  TContent = unknown,
  TStatus = unknown
> {
  /** Load historical messages for a channel. */
  loadMessages(
    channel: ChatChannelRef,
    options?: ChatMessageLoadOptions
  ): Promise<TMessage[]>;

  /**
   * Subscribe to incoming messages.
   * Returns an unsubscribe function.
   */
  subscribeMessages(listener: (message: TMessage) => void): () => void;

  /**
   * Subscribe to send-status changes for previously sent messages.
   * Returns an unsubscribe function.
   */
  subscribeMessageStatus(
    listener: (messageId: string, status: TStatus) => void
  ): () => void;

  /**
   * Send a message to a channel.
   * Returns the confirmed message object from the server / local DB.
   */
  sendMessage(content: TContent, channel: ChatChannelRef): Promise<TMessage>;
}

/** Adapter that provides the message port implementation. */
export interface ChatMessageAdapter<
  TMessage = unknown,
  TContent = unknown,
  TStatus = unknown
> extends ChatMessagePort<TMessage, TContent, TStatus> {}

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

/**
 * Consumer-facing conversation lease.
 *
 * `release()` is idempotent and owns the full teardown chain:
 * close conversation, unsubscribe, emit event.
 */
export interface ChatConversationLease {
  readonly channel: ChatChannelRef;
  readonly released: boolean;
  release(): void;
}

// ---------------------------------------------------------------------------
// Client contract
// ---------------------------------------------------------------------------

/**
 * Core chat client interface.
 *
 * Consumers depend on this interface; the concrete implementation
 * delegates to adapters.
 */
export interface ChatClient {
  readonly status: ChatClientStatus;
  readonly activeConversation: ChatConversationLease | null;

  /** The generic message port — always present at runtime. */
  readonly messages: ChatMessagePort;

  /** Boot the client. Idempotent — safe to call multiple times. */
  start(bootstrap: ChatClientBootstrap): Promise<void>;

  /** Tear down the client. Idempotent. */
  stop(): Promise<void>;

  /**
   * Open (or switch to) a conversation.
   *
   * Concurrent calls use latest-request-wins ownership. The previous lease is
   * kept alive until the winning replacement is ready, then released without
   * allowing its teardown to clear the newer active lease.
   */
  openConversation(channel: ChatChannelRef): Promise<ChatConversationLease>;

  /** Snapshot of current state. */
  getSnapshot(): ChatClientSnapshot;

  /**
   * Register an event listener.
   *
   * Returns an unsubscribe function. All subscriptions are cleaned up
   * automatically on `stop()`.
   */
  subscribe(
    event: ChatClientEvent,
    listener: (...args: any[]) => void
  ): () => void;
}
