export interface UnreadConversationUpdate {
  accountId: string;
  spaceId: string;
  channelId: string;
  channelType: number;
  unread: number;
}

export interface UnreadConversationSyncChannel {
  onmessage: ((event: MessageEvent<UnreadConversationUpdate>) => void) | null;
  postMessage(message: UnreadConversationUpdate): void;
  close(): void;
}

type UnreadConversationUpdateListener = (
  update: UnreadConversationUpdate
) => void;

export class UnreadConversationSync {
  private readonly listeners = new Set<UnreadConversationUpdateListener>();

  constructor(private readonly channel?: UnreadConversationSyncChannel) {
    if (this.channel) {
      this.channel.onmessage = (event) => {
        for (const listener of this.listeners) listener(event.data);
      };
    }
  }

  publish(update: UnreadConversationUpdate): void {
    this.channel?.postMessage(update);
  }

  subscribe(listener: UnreadConversationUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
  }
}

let browserUnreadConversationSync: UnreadConversationSync | undefined;

export function getBrowserUnreadConversationSync(): UnreadConversationSync {
  if (!browserUnreadConversationSync) {
    const BrowserBroadcastChannel =
      typeof window === "undefined" ? undefined : window.BroadcastChannel;
    const channel = !BrowserBroadcastChannel
      ? undefined
      : new BrowserBroadcastChannel("octo-unread-conversations");
    browserUnreadConversationSync = new UnreadConversationSync(channel);
  }
  return browserUnreadConversationSync;
}
