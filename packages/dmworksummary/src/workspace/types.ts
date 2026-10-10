import type { SummaryReferenceTask } from "../types/summary";
import type {
  SummaryConversationTarget,
  SummaryMessagingPort,
} from "../host/types";

export type { SummaryConversationTarget } from "../host/types";

export type SummaryWorkspaceRoute =
  | { view: "list" }
  | {
      view: "create";
      mode?: "normal" | "agent";
      source?: string;
      derivedFromTask?: SummaryReferenceTask;
      /** "+" 语义：强制开新会话，已持久化的会话挪到「上次对话」槽位。 */
      fresh?: boolean;
    }
  | { view: "detail"; taskId: number | string; originConversation?: SummaryConversationTarget }
  | {
      view: "share";
      shareId: string;
      preview?: boolean;
      originConversation?: SummaryConversationTarget;
    }
  | { view: "confirm"; taskId: number }
  | { view: "schedules" };

export interface SummaryWorkspaceProps {
  route: SummaryWorkspaceRoute;
  onRouteChange: (route: SummaryWorkspaceRoute) => void;
  onOpenConversation?: (target: SummaryConversationTarget) => Promise<void>;
  onBadgeChange?: (count: number) => void;
  messaging?: SummaryMessagingPort;
}
