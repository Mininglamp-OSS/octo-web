import type {
  SummaryCompletionNotice,
  SummaryConversationMember,
  SummaryConversationTarget,
  SummaryForwardOutcome,
} from "@dmwork/summary";
import type { SummaryWorkspaceRoute } from "@dmwork/summary";
import type { DesktopPresentationBridge, DesktopReadyCapability } from "../client-feature/desktop/presentation";

export interface SummaryBootstrap {
  bridgeVersion: 1;
  featureId: "summary";
  /** 宿主可选能力。Client 主进程传 true 时启用对应适配器。 */
  capabilities?: {
    /** docs 转换能力；为 true 时注册 docs.convertMarkdown 与 docs.openDocument 端口。 */
    docsConversion?: boolean;
  };
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

export interface OctoBuddySummaryBridge extends DesktopPresentationBridge {
  getBootstrap(): Promise<SummaryBootstrap>;
  reportReady(state: {
    bridgeVersion: 1;
    route: SummaryWorkspaceRoute;
    spaceId: string;
    rendererVersion: string;
  } & DesktopReadyCapability<SummaryWorkspaceRoute["view"]>): Promise<void>;
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
  /** 宿主侧 markdown 转文档。仅在 capabilities.docsConversion 为 true 时存在。 */
  convertMarkdown?(input: { title: string; markdown: string }, spaceId: string): Promise<
    { ok: true; value: { docId: string; url: string } }
    | { ok: false; error: { message: string; status?: number; code?: string; document?: { docId: string; url: string } } }
  >;
  /** 宿主侧打开已创建的文档。仅在 capabilities.docsConversion 为 true 时存在。 */
  openDocument?(input: { docId: string }, spaceId: string): Promise<void>;
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
