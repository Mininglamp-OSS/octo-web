import type {
  SummaryCompletionNotice,
  SummaryConversationMember,
  SummaryConversationTarget,
  SummaryForwardOutcome,
} from "@dmwork/summary";
import type { SummaryWorkspaceRoute } from "@dmwork/summary";

export interface SummaryBootstrap {
  bridgeVersion: 1;
  featureId: "summary";
  session: {
    uid: string;
    token: string;
    name: string;
    email?: string;
    provider: string;
    apiOrigin: string;
  };
  space: { id: string; name: string };
  appearance: { theme: "light" | "dark"; locale: "zh-CN" | "en-US" };
  initialRoute: SummaryWorkspaceRoute;
}

export type SummaryHostCommand =
  | { type: "navigate"; route: SummaryWorkspaceRoute }
  | { type: "spaceChanged"; space: { id: string; name: string } }
  | {
      type: "appearanceChanged";
      theme: "light" | "dark";
      locale: "zh-CN" | "en-US";
    }
  | { type: "invalidate" }
  | { type: "suspend" }
  | { type: "resume" }
  | { type: "hostVisibilityChanged"; visible: boolean }
  | { type: "sessionRevoked" };

export interface OctoBuddySummaryBridge {
  getBootstrap(): Promise<SummaryBootstrap>;
  reportReady(state: {
    bridgeVersion: 1;
    route: SummaryWorkspaceRoute;
    spaceId: string;
    rendererVersion: string;
  }): Promise<void>;
  reportRoute(report: { route: SummaryWorkspaceRoute; spaceId: string }): void;
  reportBadge(report: { count: number; spaceId: string }): void;
  reportAuthExpired(reason: string): void;
  reportFatalError(error: { message: string; stack?: string }): void;
  openConversation(target: SummaryConversationTarget, spaceId: string): Promise<void>;
  loadConversationMembers(
    target: SummaryConversationTarget,
    spaceId: string
  ): Promise<SummaryConversationMember[]>;
  notifySummaryCompleted(input: SummaryCompletionNotice, spaceId: string): Promise<void>;
  requestForward(input: {
    content: string;
    title: string;
  }, spaceId: string): Promise<SummaryForwardOutcome | null>;
  onCommand(callback: (command: SummaryHostCommand) => void): () => void;
}

declare global {
  interface Window {
    octoBuddySummary?: OctoBuddySummaryBridge;
  }
}

export function requireSummaryHostBridge(): OctoBuddySummaryBridge {
  const bridge = window.octoBuddySummary;
  if (!bridge) throw new Error("octoBuddy summary bridge is unavailable");
  return bridge;
}
