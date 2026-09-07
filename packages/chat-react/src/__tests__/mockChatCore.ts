/* Vitest alias target for @octo/chat-core so the package can be tested
 * without a built chat-core dependency. Mirrors the real exported types,
 * including the async openConversation / ChatConversationLease contract. */

import type {
  ChatClient,
  ChatClientBootstrap,
  ChatChannelRef,
  ChatConversationLease,
  ChatClientSnapshot,
} from '@octo/chat-core'

export type {
  ChatClient,
  ChatClientBootstrap,
  ChatChannelRef,
  ChatConversationLease,
  ChatClientSnapshot,
}

export enum ChatClientStatus {
  Idle = 'idle',
  Connecting = 'connecting',
  Connected = 'connected',
  Disconnected = 'disconnected',
  Failed = 'failed',
  Stopped = 'stopped',
}

export enum ChatClientEvent {
  StatusChanged = 'statusChanged',
  ConversationOpened = 'conversationOpened',
  ConversationClosed = 'conversationClosed',
  Error = 'error',
  MessageReceived = 'messageReceived',
  MessageStatusChanged = 'messageStatusChanged',
}

export class ChatConversationSupersededError extends Error {
  constructor() {
    super('The conversation open request was superseded by a newer request.')
    this.name = 'ChatConversationSupersededError'
  }
}

export const channelA: ChatChannelRef = { channelId: 'channel-a', channelType: 1 }
export const channelB: ChatChannelRef = { channelId: 'channel-b', channelType: 1 }

export interface PendingOpen {
  lease: ChatConversationLease
  channel: ChatChannelRef
  resolve(): void
}

export interface MockChatClient extends ChatClient {
  startCalls: ChatClientBootstrap[]
  stopCalls: number
  openCalls: ChatChannelRef[]
  /** Every lease created in order, so tests can inspect releases. */
  leases: ChatConversationLease[]
  pendingOpens: PendingOpen[]
  emit(event: ChatClientEvent, ...args: any[]): void
  /** Cause the *next* openConversation to remain pending until released. */
  deferNextOpen(): void
  /** Resolve the next pending openConversation (calls activeLease set). */
  resolveNextPending(): void
  flush(): Promise<void>
}

export function createMockClient(): MockChatClient {
  const listeners = new Map<ChatClientEvent, Set<(...args: any[]) => void>>()
  const leases: ChatConversationLease[] = []
  let connectionStatus: ChatClientStatus = 'idle'
  let activeLease: ChatConversationLease | null = null
  let deferNext = false
  const pendingOpens: PendingOpen[] = []

  function makeLease(channel: ChatChannelRef): ChatConversationLease {
    let released = false
    return {
      channel,
      get released() {
        return released
      },
      release() {
        released = true
      },
    }
  }

  const client: MockChatClient = {
    get status() {
      return connectionStatus
    },
    get activeConversation() {
      return activeLease
    },
    messages: {
      loadMessages: async () => [],
      subscribeMessages: () => () => {},
      subscribeMessageStatus: () => () => {},
      sendMessage: async () => ({}),
    },
    startCalls: [],
    stopCalls: 0,
    openCalls: [],
    leases,
    pendingOpens,

    async start(bootstrap: ChatClientBootstrap) {
      const previousStatus = connectionStatus
      connectionStatus = 'connected'
      client.startCalls.push(bootstrap)
      client.emit(ChatClientEvent.StatusChanged, ChatClientStatus.Connected, previousStatus)
    },

    async stop() {
      const previousStatus = connectionStatus
      if (activeLease && !activeLease.released) activeLease.release()
      activeLease = null
      connectionStatus = 'stopped'
      client.stopCalls += 1
      client.emit(ChatClientEvent.StatusChanged, ChatClientStatus.Stopped, previousStatus)
    },

    getSnapshot(): ChatClientSnapshot {
      return { status: connectionStatus, activeConversation: activeLease }
    },

    subscribe(event: ChatClientEvent, listener: (...args: any[]) => void) {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener)
      return () => {
        set!.delete(listener)
      }
    },

    async openConversation(channel: ChatChannelRef) {
      const lease = makeLease(channel)
      leases.push(lease)
      client.openCalls.push(channel)

      if (deferNext) {
        deferNext = false
        return new Promise<ChatConversationLease>((resolve) => {
          pendingOpens.push({
            lease,
            channel,
            resolve: () => {
              activeLease = lease
              resolve(lease)
            },
          })
        })
      }

      activeLease = lease
      return lease
    },

    emit(event: ChatClientEvent, ...args: any[]) {
      const set = listeners.get(event)
      if (set) set.forEach((listener) => listener(...args))
    },

    deferNextOpen() {
      deferNext = true
    },

    resolveNextPending() {
      const pending = pendingOpens.shift()
      if (pending) pending.resolve()
    },

    async flush() {
      while (pendingOpens.length > 0) {
        pendingOpens.shift()!.resolve()
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    },
  }

  return client
}
