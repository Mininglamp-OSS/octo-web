export type SummaryWorkbenchResultType =
  | "clarification"
  | "explanation"
  | "workflow_confirmation"
  | "workflow_started"
  | "workflow_completed"
  | "agent_preview"
  | "agent_revision"
  | "error";

export type SummaryWorkbenchAction =
  | "confirm_workflow"
  | "save_preview"
  | "view_summary"
  | "view_progress"
  | "continue_chat";

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

export interface SummaryWorkbenchMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  resultType?: SummaryWorkbenchResultType;
}

export interface SummaryWorkbenchProgressView {
  phase: string;
  count?: number;
}

interface SummaryWorkbenchCardBase {
  isStale: boolean;
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
import type { ReactNode } from "react";
