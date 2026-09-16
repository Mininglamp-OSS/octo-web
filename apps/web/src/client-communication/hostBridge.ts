import type { AttachmentPreviewHost } from "@octo/base/src/features/filePreview/attachmentHost";
import type { LayoutAttachmentHost } from "@octo/base/src/features/filePreview/hostPreviewLayout";

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
  variant?: "app-bot" | "workspace-group";
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
  runtime?: OwnerRuntimeBootstrap;
}

export type HostCommand =
  | {
      type: "navigate";
      page: CommunicationPage;
      presentation?: CommunicationPresentation;
      target?: ConversationTarget;
      /** Optional positive safe-integer provided by the Client to acknowledge this navigation commit. */
      navigationId?: number;
    }
  | { type: "spaceChanged"; space: { id: string; name: string } }
  | { type: "appearanceChanged"; theme: "light" | "dark"; locale: "zh-CN" | "en-US" }
  | { type: "suspend" }
  | { type: "resume" }
  | { type: "hostVisibilityChanged"; visible: boolean }
  | { type: "filePreviewClosed"; requestId: string }
  | { type: "filePreviewState"; requestId: string; phase: "loading" | "ready" | "error"; error?: string }
  | { type: "sessionRevoked" };

export interface NavigationReport {
  page: CommunicationPage;
  source: "host" | "contact-card" | "group-card" | "notification" | "internal" | "workspace-conversation" | "workspace-selection-cancelled";
  channel?: { id: string; type: number };
  cancelledTarget?: { id: string; type: number };
}

export type SummaryCapabilityRequest = {
  requestId: string;
  spaceId: string;
  operation:
    | "loadConversationMembers"
    | "notifySummaryCompleted"
    | "requestForward";
  payload: unknown;
  runtimeScope?: RuntimeScope;
};

export interface SummaryCapabilityResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface DocumentForwardInput {
  docId: string;
  title: string;
  link: string;
  shareAsCard?: boolean;
  spaceId?: string;
  kind?: "doc" | "board" | "sheet" | "html";
  ownerName?: string;
  updatedAt?: string;
  canGrant: boolean;
  disabledReason?: string;
  defaultRole?: "reader" | "commenter" | "writer";
  modalTitle?: string;
}

export interface DocumentForwardRequest {
  requestId: string;
  spaceId: string;
  input: DocumentForwardInput;
  runtimeScope?: RuntimeScope;
}

export interface OctoBuddyCommunicationBridge {
  publishForwardSurface?(update: import("@octo/base/src/features/forwarding/surfaceContract").ForwardSurfaceUpdate): Promise<void>;
  onForwardSurfaceAction?(listener: (command: import("@octo/base/src/features/forwarding/surfaceContract").ForwardSurfaceCommand) => void): () => void;
  reportRuntimeReady?(state: RuntimeReady): Promise<void>;
  reportRuntimeSnapshot?(snapshot: RuntimeSnapshot): void;
  reportRuntimeCommandResult?(result: RuntimeCommandResult): void;
  onRuntimeCommand?(callback: (command: unknown) => void): () => void;
  scheduleRuntimeTask?(timer: RuntimeTimer & { delayMs: number }): void;
  cancelRuntimeTask?(timer: RuntimeTimer): void;
  getDesktopPresentation?(): Promise<import("./desktopPresentation").DesktopPresentation | null>;
  onDesktopPresentation?(callback: (state: import("./desktopPresentation").DesktopPresentation) => void): () => void;
  getDocumentPreview?: import("@octo/base/src/Service/DocumentPreviewService").DocumentPreviewTransport;
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
    documentForwardVersion?: 1;
    navigationCommitVersion?: 1;
    desktopPresentationVersion?: 1;
    /** Complete page allowlist; older v1 renderers without this field support chat only. */
    desktopPresentationPages?: readonly CommunicationPage[];
  }): Promise<void>;
  reportNavigation(state: NavigationReport): Promise<void>;
  /** Optional; when present the renderer advertises navigationCommitVersion: 1 and acknowledges navigate commits. */
  reportNavigationCommitted?(params: { navigationId: number }): Promise<void>;
  reportUnread(count: number): void;
  reportAuthExpired(reason: string): void;
  reportFatalError(error: { message: string; stack?: string }): void;
  respondSummaryRequest?(response: SummaryCapabilityResponse): void;
  onSummaryRequest?(
    callback: (request: SummaryCapabilityRequest) => void
  ): () => void;
  onDocumentForward?(callback: (request: DocumentForwardRequest) => void): () => void;
  onDocumentForwardCancel?(callback: (request: { requestId: string }) => void): () => void;
  grantDocumentForward?(request: {
    requestId: string;
    uids: string[];
    role: "reader" | "commenter" | "writer";
  }): Promise<{ granted: number; failed: number; failures?: string[]; rejected?: string[] }>;
  authorizeDocumentForward?(request: { requestId: string }): Promise<void>;
  respondDocumentForward?(response: SummaryCapabilityResponse): void;
  onCommand(callback: (command: HostCommand) => void): () => void;
  /** Optional host port for message-attachment file preview. */
  openFilePreview?: AttachmentPreviewHost["openFilePreview"];
  cancelFilePreview?: AttachmentPreviewHost["cancelFilePreview"];
  openFilePreviewInPlace?: LayoutAttachmentHost["openFilePreviewInPlace"];
  setFilePreviewLayout?: LayoutAttachmentHost["setFilePreviewLayout"];
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
import type { OwnerRuntimeBootstrap, RuntimeCommandResult, RuntimeReady, RuntimeScope, RuntimeSnapshot, RuntimeTimer } from "../client-feature/runtimeContract";
