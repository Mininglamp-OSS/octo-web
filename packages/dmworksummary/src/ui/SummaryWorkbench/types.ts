import type { ReactNode } from "react";
import type {
  SummaryWorkspaceAction,
  SummaryWorkspaceResultType,
} from "../../bridge/summaryWorkbench/protocol";

export type SummaryWorkbenchResultType = SummaryWorkspaceResultType;
export type SummaryWorkbenchAction = SummaryWorkspaceAction;

export type SummaryWorkbenchContextKind =
  | "chat"
  | "participant"
  | "template"
  | "time_range"
  | "reference";

export interface SummaryWorkbenchContextItem {
  id: string;
  kind: SummaryWorkbenchContextKind;
  label: string;
}

export interface SummaryWorkbenchProgressView {
  phase: string;
  count?: number;
}

export interface SummaryWorkbenchProcessView {
  status: "running" | "completed";
  steps: SummaryWorkbenchProgressView[];
}

export interface SummaryWorkbenchMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  resultType?: SummaryWorkbenchResultType;
  card?: SummaryWorkbenchCardView;
  process?: SummaryWorkbenchProcessView;
}

interface SummaryWorkbenchCardBase {
  isStale: boolean;
  isHistorical?: boolean;
  actions: SummaryWorkbenchAction[];
}

export interface SummaryWorkbenchTeamCard extends SummaryWorkbenchCardBase {
  kind: "team_confirmation";
  participantNames: string[];
  requirement: string;
  templateLabel?: string;
  timeRangeLabel?: string;
}

export interface SummaryWorkbenchWorkflowCard extends SummaryWorkbenchCardBase {
  kind: "workflow_started" | "workflow_completed";
  taskId: number;
  taskTitle: string;
  participantCount?: number;
}

export interface SummaryWorkbenchPreviewCard extends SummaryWorkbenchCardBase {
  kind: "agent_preview" | "agent_revision";
  version: number;
  content: string;
  assumptions: string[];
}

export type SummaryWorkbenchCardView =
  | SummaryWorkbenchTeamCard
  | SummaryWorkbenchWorkflowCard
  | SummaryWorkbenchPreviewCard;

const CARD_ACTIONS: Record<
  SummaryWorkbenchCardView["kind"],
  readonly SummaryWorkbenchAction[]
> = {
  team_confirmation: ["confirm_workflow", "continue_chat"],
  workflow_started: ["view_progress", "continue_chat"],
  workflow_completed: ["view_summary"],
  agent_preview: ["save_preview", "continue_chat"],
  agent_revision: ["save_preview", "continue_chat"],
};

export function visibleSummaryWorkbenchActions(
  kind: SummaryWorkbenchCardView["kind"],
  actions: SummaryWorkbenchAction[],
  isStale: boolean
): SummaryWorkbenchAction[] {
  return actions.filter(
    (action, index) =>
      actions.indexOf(action) === index &&
      CARD_ACTIONS[kind].includes(action) &&
      (!isStale || (action !== "confirm_workflow" && action !== "save_preview"))
  );
}

export interface SummaryWorkbenchViewState {
  layout: "full" | "panel";
  messages: SummaryWorkbenchMessageView[];
  contextItems: SummaryWorkbenchContextItem[];
  card?: SummaryWorkbenchCardView;
  inputValue: string;
  composerFocusKey?: number;
  placeholderKey: string;
  isSending: boolean;
  canSend: boolean;
  isHydrating?: boolean;
  progressSteps?: SummaryWorkbenchProgressView[];
  sendLabelKey?: string;
  errorMessage?: string;
  showTemplateTrigger?: boolean;
}

export interface SummaryWorkbenchActions {
  onInputChange: (value: string) => void;
  onSend: () => void;
  onOpenContext: (kind: SummaryWorkbenchContextKind) => void;
  onRemoveContext: (kind: SummaryWorkbenchContextKind, id: string) => void;
  onResultAction: (action: SummaryWorkbenchAction) => void;
  onNewSession?: () => void;
}

export interface SummaryWorkbenchProps {
  state: SummaryWorkbenchViewState;
  actions: SummaryWorkbenchActions;
  className?: string;
  contextPanel?: ReactNode;
}
