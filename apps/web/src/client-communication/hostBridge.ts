export type CommunicationPage = "chat" | "contacts";
export type CommunicationPresentation = "workspace" | "conversation";

export interface ConversationTarget {
  channelId: string;
  channelType: number;
  messageSeq?: number;
  openChannelSearch?: boolean;
  displayName?: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
  variant?: "app-bot";
}

export interface CommunicationBootstrap {
  bridgeVersion: 1;
  featureId: "communication";
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
  | { type: "hostVisibilityChanged"; visible: boolean }
  | { type: "sessionRevoked" };

export interface NavigationReport {
  page: CommunicationPage;
  source: "host" | "contact-card" | "group-card" | "notification" | "internal";
  channel?: { id: string; type: number };
}

export type SummaryCapabilityRequest = {
  requestId: string;
  spaceId: string;
  operation:
    | "loadConversationMembers"
    | "notifySummaryCompleted"
    | "requestForward";
  payload: unknown;
};

export interface SummaryCapabilityResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface OctoBuddyCommunicationBridge {
  openSummary(request: {
    route: import("@dmwork/summary").SummaryWorkspaceRoute;
    spaceId: string;
  }): Promise<void>;
  getBootstrap(): Promise<CommunicationBootstrap>;
  /** May be retried after a timeout; hosts must handle duplicate reports. */
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
  respondSummaryRequest?(response: SummaryCapabilityResponse): void;
  onSummaryRequest?(
    callback: (request: SummaryCapabilityRequest) => void
  ): () => void;
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
