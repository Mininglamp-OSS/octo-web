import {
  ChatClientBootstrap,
  ChatClient,
  ChatClientEvent,
  ChatClientSnapshot,
  ChatClientStatus,
  ChatChannelRef,
  ChatConversationLease,
  ChatConversationHandle,
  ChatConnectionAdapter,
  ChatConnectionContext,
  ChatConversationAdapter,
  ChatSubscribeAdapter,
  ChatMessageAdapter,
  ChatMessagePort,
} from "./types";

type EventListener = (...args: any[]) => void;

// ---------------------------------------------------------------------------
// ManagedChatClient
// ---------------------------------------------------------------------------

export interface ManagedChatClientOptions<
  TMessage = unknown,
  TContent = unknown,
  TStatus = unknown
> {
  subscribeAdapter?: ChatSubscribeAdapter;
  messageAdapter?: ChatMessageAdapter<TMessage, TContent, TStatus>;
}

/**
 * A controlled lease returned by `ManagedChatClient`.
 *
 * `release()` owns the full teardown chain and is idempotent. The adapter
 * handle stays private; consumers only ever interact with this lease.
 */
class ManagedConversationLease implements ChatConversationLease {
  readonly channel: ChatChannelRef;
  private _released = false;
  private _cleanupPromise: Promise<void> | null = null;
  private _subscribed = false;
  private _opened = false;

  constructor(
    private readonly _owner: ManagedChatClient,
    readonly _handle: ChatConversationHandle
  ) {
    this.channel = _handle.channel;
  }

  get released(): boolean {
    return this._released;
  }

  release(): void {
    if (!this._requestRelease()) return;
    this._owner._scheduleRelease(this);
  }

  _requestRelease(): boolean {
    if (this._released) return false;
    this._released = true;
    return true;
  }

  _ensureCleanup(operation: () => Promise<void>): Promise<void> {
    this._released = true;
    if (!this._cleanupPromise) {
      const cleanupPromise = Promise.resolve().then(operation).catch((error) => {
        if (this._cleanupPromise === cleanupPromise) {
          this._cleanupPromise = null;
        }
        throw error;
      });
      this._cleanupPromise = cleanupPromise;
    }
    return this._cleanupPromise;
  }

  _markSubscribed(): void {
    this._subscribed = true;
  }

  get _wasSubscribed(): boolean {
    return this._subscribed;
  }

  _markUnsubscribed(): void {
    this._subscribed = false;
  }

  _markOpened(): void {
    this._opened = true;
  }

  get _wasOpened(): boolean {
    return this._opened;
  }

  _markClosed(): void {
    this._opened = false;
  }
}

/** Raised when a newer open request or stop supersedes a pending request. */
export class ChatConversationSupersededError extends Error {
  constructor() {
    super("The conversation open request was superseded by a newer request.");
    this.name = "ChatConversationSupersededError";
  }
}

/**
 * Concrete ChatClient that delegates to adapters and manages:
 *
 * - Idempotent start / stop
 * - Single active-conversation ownership with safe switching
 * - Automatic lease release on stop / switch
 * - Event subscriptions that remain observable across explicit restarts
 * - Failed-state support
 * - A generic message port routed to the optional message adapter
 */
export class ManagedChatClient<
  TMessage = unknown,
  TContent = unknown,
  TStatus = unknown
> implements ChatClient
{
  private _status: ChatClientStatus = ChatClientStatus.Idle;
  private _currentLease: ManagedConversationLease | null = null;
  private _bootstrap: ChatClientBootstrap | null = null;
  private _listeners = new Map<ChatClientEvent, Set<EventListener>>();

  // Adapter state
  private _connectionAdapter: ChatConnectionAdapter;
  private _conversationAdapter: ChatConversationAdapter;
  private _subscribeAdapter: ChatSubscribeAdapter | null;

  /** Generic message port — always present, delegates to the message adapter. */
  readonly messages: ChatMessagePort<TMessage, TContent, TStatus>;

  // Connection, conversation and lease teardown side effects share one queue.
  // This makes stop a real teardown barrier and prevents same-channel
  // subscribe/unsubscribe operations from overtaking each other.
  private _operationQueue: Promise<void> = Promise.resolve();
  // Tracks whether we have started (for idempotent stop).
  private _started = false;
  // A failed connect may still leave transport resources behind. Keep cleanup
  // pending until disconnect succeeds so retries cannot stack transports.
  private _connectionNeedsDisconnect = false;
  // Open requests are queued, but only the latest requested channel is allowed
  // to commit after an asynchronous adapter call resolves.
  private _openRequestGeneration = 0;
  private _connectionEpoch = 0;
  private _connectionAvailable = true;
  private _connectionContext = this._createConnectionContext(0);
  private _backgroundTeardownError: Error | null = null;

  constructor(
    connectionAdapter: ChatConnectionAdapter,
    conversationAdapter: ChatConversationAdapter,
    options: ManagedChatClientOptions<TMessage, TContent, TStatus> = {}
  ) {
    this._connectionAdapter = connectionAdapter;
    this._conversationAdapter = conversationAdapter;
    this._subscribeAdapter = options.subscribeAdapter ?? null;
    this.messages =
      options.messageAdapter ?? this._createUnavailableMessagePort();
  }

  // ---- accessors ----------------------------------------------------------

  get status(): ChatClientStatus {
    return this._status;
  }

  get activeConversation(): ChatConversationLease | null {
    return this._currentLease && !this._currentLease.released
      ? this._currentLease
      : null;
  }

  get connectionContext(): ChatConnectionContext {
    return this._connectionContext;
  }

  // ---- start / stop ------------------------------------------------------

  start(bootstrap: ChatClientBootstrap): Promise<void> {
    return this._enqueueOperation(async () => {
      // Once started, the connection adapter owns reconnect behavior and
      // reports availability through the epoch-scoped connection context.
      // Calling start() again while disconnected must not create a second
      // transport or duplicate its listeners.
      if (this._started) {
        return;
      }

      // A previous stop may have failed while releasing a conversation. Retry
      // the unfinished teardown before opening a new transport.
      if (this._currentLease) {
        await this._releaseCurrentLease();
      }

      if (this._connectionNeedsDisconnect) {
        try {
          await this._connectionAdapter.disconnect();
          this._connectionNeedsDisconnect = false;
        } catch (error) {
          const cleanupError = this._createAdapterError("start cleanup", [
            error,
          ]);
          this._setStatus(ChatClientStatus.Failed);
          this._emit(ChatClientEvent.Error, cleanupError);
          throw cleanupError;
        }
      }

      this._bootstrap = bootstrap;
      const connectionEpoch = ++this._connectionEpoch;
      this._connectionAvailable = true;
      this._connectionContext = this._createConnectionContext(connectionEpoch);
      this._setStatus(ChatClientStatus.Connecting);
      this._connectionNeedsDisconnect = true;

      try {
        await this._connectionAdapter.connect(
          bootstrap,
          this._connectionContext
        );
      } catch (err) {
        this._connectionEpoch += 1;
        this._bootstrap = null;
        const errors: unknown[] = [err];
        try {
          await this._connectionAdapter.disconnect();
          this._connectionNeedsDisconnect = false;
        } catch (cleanupError) {
          errors.push(cleanupError);
        }
        this._setStatus(ChatClientStatus.Failed);
        if (errors.length > 1) {
          const error = this._createAdapterError("start", errors);
          this._emit(ChatClientEvent.Error, error);
          throw error;
        }
        throw err;
      }

      this._started = true;
      if (connectionEpoch === this._connectionEpoch) {
        this._setStatus(
          this._connectionAvailable
            ? ChatClientStatus.Connected
            : ChatClientStatus.Disconnected
        );
      }
    });
  }

  stop(): Promise<void> {
    this._openRequestGeneration += 1;
    this._connectionEpoch += 1;

    return this._enqueueOperation(async () => {
      const errors: unknown[] = [];
      const backgroundTeardownError = this._backgroundTeardownError;
      this._backgroundTeardownError = null;
      const hadPendingLease = this._currentLease !== null;
      try {
        await this._releaseCurrentLease();
      } catch (error) {
        errors.push(error);
      }
      if (backgroundTeardownError && !hadPendingLease) {
        errors.push(backgroundTeardownError);
      }

      if (this._connectionNeedsDisconnect) {
        try {
          await this._connectionAdapter.disconnect();
          this._connectionNeedsDisconnect = false;
        } catch (error) {
          errors.push(error);
          this._emit(ChatClientEvent.Error, error);
        }
      }

      this._started = false;
      this._bootstrap = null;

      this._setStatus(ChatClientStatus.Stopped);

      if (errors.length > 0) {
        throw this._createAdapterError("stop", errors);
      }
    });
  }

  // ---- conversation management -------------------------------------------

  async openConversation(
    channel: ChatChannelRef
  ): Promise<ChatConversationLease> {
    const requestGeneration = ++this._openRequestGeneration;
    return this._enqueueOperation(async () => {
      if (!this._started) {
        throw new Error(
          "ManagedChatClient.openConversation: client is not started."
        );
      }
      if (this._status === ChatClientStatus.Failed) {
        throw new Error(
          "ManagedChatClient.openConversation: client must be restarted after an adapter teardown failure."
        );
      }
      this._throwIfOpenSuperseded(requestGeneration);

      let handle: ChatConversationHandle;
      try {
        handle = await this._conversationAdapter.openConversation(channel);
      } catch (error) {
        this._throwIfOpenSuperseded(requestGeneration);
        throw error;
      }
      let subscribed = false;

      try {
        this._throwIfOpenSuperseded(requestGeneration);

        const oldLease = this._currentLease;
        if (oldLease) {
          await this._teardownLease(oldLease);
          this._throwIfOpenSuperseded(requestGeneration);
        }

        if (this._subscribeAdapter) {
          try {
            await this._subscribeAdapter.subscribe(channel);
            subscribed = true;
          } catch (error) {
            this._emit(
              ChatClientEvent.Error,
              this._createAdapterError("conversation subscription", [error]),
            );
          }
          this._throwIfOpenSuperseded(requestGeneration);
        }

        this._throwIfOpenSuperseded(requestGeneration);
        const newLease = new ManagedConversationLease(this, handle);
        if (subscribed) newLease._markSubscribed();
        newLease._markOpened();
        this._currentLease = newLease;
        this._emit(ChatClientEvent.ConversationOpened, channel);
        return newLease;
      } catch (error) {
        await this._discardHandle(handle, channel, subscribed);
        throw error;
      }
    });
  }

  // ---- snapshot ----------------------------------------------------------

  getSnapshot(): ChatClientSnapshot {
    return {
      status: this._status,
      activeConversation: this.activeConversation,
    };
  }

  // ---- subscriptions -----------------------------------------------------

  subscribe(
    event: ChatClientEvent,
    listener: (...args: any[]) => void
  ): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(listener);

    return () => {
      const set = this._listeners.get(event);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this._listeners.delete(event);
      }
    };
  }

  // ---- internal helpers --------------------------------------------------

  private _setStatus(status: ChatClientStatus): void {
    const prev = this._status;
    this._status = status;
    if (prev !== status) {
      this._emit(ChatClientEvent.StatusChanged, status, prev);
    }
  }

  private _emit(event: ChatClientEvent, ...args: any[]): void {
    const set = this._listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(...args);
        } catch {
          // Swallow individual listener errors
        }
      }
    }
  }

  private _enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this._operationQueue.then(operation, operation);
    this._operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async _releaseCurrentLease(): Promise<void> {
    const lease = this._currentLease;
    if (lease) {
      await this._teardownLease(lease);
    }
  }

  /**
   * Full teardown for a controlled lease — single idempotent entry point.
   *
   * Marks the lease released (first call only), then runs the teardown
   * chain: close conversation, unsubscribe, clear active (only if the
   * released lease is still current), and emit the closed event.
   */
  _scheduleRelease(lease: ManagedConversationLease): void {
    void this._enqueueOperation(() => this._teardownLease(lease)).catch(
      (error) => {
        if (this._status !== ChatClientStatus.Stopped) {
          this._backgroundTeardownError =
            error instanceof Error ? error : new Error(String(error));
        }
      }
    );
  }

  private async _teardownLease(lease: ManagedConversationLease): Promise<void> {
    await lease._ensureCleanup(async () => {
      const errors: unknown[] = [];
      if (lease._wasOpened) {
        try {
          await this._conversationAdapter.closeConversation(lease._handle);
          lease._markClosed();
          this._emit(ChatClientEvent.ConversationClosed, lease.channel);
        } catch (error) {
          errors.push(error);
        }
      }
      if (lease._wasSubscribed && this._subscribeAdapter) {
        try {
          await this._subscribeAdapter.unsubscribe(lease.channel);
          lease._markUnsubscribed();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        const error = this._createAdapterError("conversation teardown", errors);
        this._setStatus(ChatClientStatus.Failed);
        this._emit(ChatClientEvent.Error, error);
        throw error;
      }
      if (this._currentLease === lease) {
        this._currentLease = null;
      }
    });
  }

  private async _discardHandle(
    handle: ChatConversationHandle,
    channel: ChatChannelRef,
    subscribed: boolean
  ): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this._conversationAdapter.closeConversation(handle);
    } catch (error) {
      errors.push(error);
    }
    if (subscribed && this._subscribeAdapter) {
      try {
        await this._subscribeAdapter.unsubscribe(channel);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      const error = this._createAdapterError(
        "superseded conversation cleanup",
        errors
      );
      this._setStatus(ChatClientStatus.Failed);
      this._emit(ChatClientEvent.Error, error);
      throw error;
    }
  }

  private _throwIfOpenSuperseded(requestGeneration: number): void {
    if (requestGeneration !== this._openRequestGeneration || !this._started) {
      throw new ChatConversationSupersededError();
    }
  }

  private _createConnectionContext(epoch: number): ChatConnectionContext {
    return {
      onConnectionLost: () => this._handleConnectionLost(epoch),
      onConnectionRestored: () => this._handleConnectionRestored(epoch),
    };
  }

  private _createAdapterError(operation: string, errors: unknown[]): Error {
    const detail = errors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    return new Error(`ManagedChatClient ${operation} failed: ${detail}`);
  }

  private _handleConnectionLost(epoch: number): void {
    if (epoch !== this._connectionEpoch) return;
    this._connectionAvailable = false;
    if (
      this._status === ChatClientStatus.Connected ||
      this._status === ChatClientStatus.Connecting
    ) {
      this._setStatus(ChatClientStatus.Disconnected);
    }
  }

  private _handleConnectionRestored(epoch: number): void {
    if (epoch !== this._connectionEpoch) return;
    this._connectionAvailable = true;
    if (this._status === ChatClientStatus.Disconnected) {
      this._setStatus(
        this._started ? ChatClientStatus.Connected : ChatClientStatus.Connecting
      );
    }
  }

  /** Clear-error message port for when no message adapter is configured. */
  private _createUnavailableMessagePort(): ChatMessagePort<
    TMessage,
    TContent,
    TStatus
  > {
    const asyncUnavailable = (operation: string) =>
      Promise.reject(
        new Error(
          `ManagedChatClient.${operation}: requires a ChatMessageAdapter, which was not configured for this client.`
        )
      );
    const syncUnavailable = (operation: string): never => {
      throw new Error(
        `ManagedChatClient.${operation}: requires a ChatMessageAdapter, which was not configured for this client.`
      );
    };
    return {
      loadMessages: () => asyncUnavailable("loadMessages"),
      subscribeMessages: () => syncUnavailable("subscribeMessages"),
      subscribeMessageStatus: () => syncUnavailable("subscribeMessageStatus"),
      sendMessage: () => asyncUnavailable("sendMessage"),
    };
  }
}
