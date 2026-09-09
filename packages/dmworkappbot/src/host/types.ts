export interface AppBotSpace {
  id: string;
  name: string;
}

export interface AppBotConversationTarget {
  channelId: string;
  channelType: number;
  displayName: string;
  avatar: string;
  metadata: {
    displayName: string;
    robot: 1;
    name: string;
  };
}

export interface AppBotHostCapabilities {
  getCurrentSpace(): AppBotSpace;
  resolveSpaceName(spaceId: string): Promise<string>;
  subscribeSpaceChanged(listener: () => void): () => void;
  openConversation(target: AppBotConversationTarget): Promise<void>;
  clearConversation(): void;
  isOctoAssistant(uid: string): boolean;
  track(event: string, properties?: Record<string, unknown>): void;
}
