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
