export type CommunicationPage = "chat" | "contacts";
export type CommunicationPresentation = "workspace" | "conversation";

export interface ConversationTarget {
  channelId: string;
  channelType: number;
  messageSeq?: number;
  openChannelSearch?: boolean;
}

export interface CommunicationBootstrap {
  bridgeVersion: 1;
  session: {
    uid: string;
    token: string;
    name: string;
    email?: string;
    provider: string;
    apiOrigin: string;
  };
  space: {
    id: string;
    name: string;
  };
  appearance: {
    theme: "light" | "dark";
    locale: "zh-CN" | "en-US";
  };
  initialPage: CommunicationPage;
  initialPresentation: CommunicationPresentation;
}

export type HostCommand =
  | {
      type: "navigate";
      page: CommunicationPage;
      presentation?: CommunicationPresentation;
      target?: ConversationTarget;
    }
  | { type: "spaceChanged"; space: { id: string; name: string } }
  | { type: "appearanceChanged"; theme: "light" | "dark"; locale: "zh-CN" | "en-US" }
  | { type: "suspend" }
  | { type: "resume" }
  | { type: "sessionRevoked" };

export interface NavigationReport {
  page: CommunicationPage;
  source: "host" | "contact-card" | "group-card" | "notification" | "internal";
  channel?: { id: string; type: number };
}

export interface OctoBuddyCommunicationBridge {
  getBootstrap(): Promise<CommunicationBootstrap>;
  reportReady(state: {
    bridgeVersion: 1;
    page: CommunicationPage;
    spaceId: string;
    rendererVersion: string;
  }): Promise<void>;
  reportNavigation(state: NavigationReport): Promise<void>;
  reportUnread(count: number): void;
  reportAuthExpired(reason: string): void;
  reportFatalError(error: { message: string; stack?: string }): void;
  onCommand(callback: (command: HostCommand) => void): () => void;
}

declare global {
  interface Window {
    octoBuddyCommunication?: OctoBuddyCommunicationBridge;
  }
}

export function requireHostBridge(): OctoBuddyCommunicationBridge {
  const bridge = window.octoBuddyCommunication;
  if (!bridge) throw new Error("octoBuddy communication bridge is unavailable");
  return bridge;
}
