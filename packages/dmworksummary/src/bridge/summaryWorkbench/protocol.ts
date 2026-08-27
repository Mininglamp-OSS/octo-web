import type { AgentProgressEvent } from "../../types/summary";

export const SUMMARY_WORKSPACE_CONTRACT_VERSION = "1";
export const SUMMARY_WORKSPACE_PROFILE = "summary_workspace";

export type SummaryWorkspaceResultType =
  | "clarification"
  | "explanation"
  | "workflow_confirmation"
  | "workflow_started"
  | "workflow_completed"
  | "agent_preview"
  | "agent_revision"
  | "error";

export type SummaryWorkspaceAction =
  | "confirm_workflow"
  | "save_preview"
  | "view_summary"
  | "view_progress"
  | "continue_chat";

export interface SummaryWorkbenchChannelScope {
  chatId: string;
  chatType: "group" | "direct" | "thread";
  name: string;
  isArchived?: boolean;
}

export interface SummaryWorkbenchParticipantScope {
  userId: string;
  userName?: string;
}

export interface SummaryWorkbenchTemplateScope {
  templateId: string;
  label: string;
  requirement: string;
  version?: number;
}

export interface SummaryWorkbenchTimeRangeScope {
  start: string;
  end: string;
  label: string;
}

export interface SummaryWorkbenchScope {
  selectedChannels: SummaryWorkbenchChannelScope[];
  participants: SummaryWorkbenchParticipantScope[];
  template: SummaryWorkbenchTemplateScope | null;
  timeRange: SummaryWorkbenchTimeRangeScope | null;
  referencedTaskIds: number[];
}

export interface SummaryWorkspaceChannelDTO {
  chat_id: string;
  chat_type: "group" | "direct" | "thread";
  name: string;
  is_archived?: boolean;
}

export interface SummaryWorkspaceParticipantDTO {
  user_id: string;
  user_name?: string;
}

export interface SummaryWorkspaceTemplateDTO {
  template_id: string;
  label: string;
  requirement: string;
  version?: number;
}

export interface SummaryWorkspaceTimeRangeDTO {
  start: string;
  end: string;
  label: string;
}

export interface SummaryWorkspaceContextDTO {
  selected_channels: SummaryWorkspaceChannelDTO[];
  participants: SummaryWorkspaceParticipantDTO[];
  template: SummaryWorkspaceTemplateDTO | null;
  time_range: SummaryWorkspaceTimeRangeDTO | null;
  referenced_task_ids: number[];
}

export interface SummaryWorkspaceChatRequestDTO {
  session_id: string;
  profile: typeof SUMMARY_WORKSPACE_PROFILE;
  action: "chat";
  message: string;
  request_id: string;
  scope_version: number;
  summary_context: SummaryWorkspaceContextDTO;
}

export interface SummaryWorkspaceConfirmRequestDTO {
  session_id: string;
  proposal_version: number;
  proposal_token: string;
  scope_version: number;
  summary_context: SummaryWorkspaceContextDTO;
}

export interface SummaryWorkspaceSavePreviewRequestDTO {
  session_id: string;
  agent_message_id: number;
  snapshot_version: number;
  scope_version: number;
  expected_artifact_version: number;
  title?: string;
  request_id?: string;
}

export interface SummaryWorkspaceCapabilitiesDTO {
  enabled: boolean;
  contract_version: string;
}

export interface SummaryWorkspacePreviewDTO {
  message_id: number;
  result_type: "agent_preview" | "agent_revision";
  scope_version: number;
  artifact_version: number;
  snapshot_version: number;
  content: string;
  assumptions: string[];
  available_actions: SummaryWorkspaceAction[];
}

export interface SummaryWorkspaceProposalDTO {
  message_id: number;
  scope_version: number;
  proposal_version: number;
  proposal_token: string;
  participants: SummaryWorkspaceParticipantDTO[];
  requirement: string;
  template_label?: string;
  time_range_label?: string;
  available_actions: SummaryWorkspaceAction[];
}

export interface SummaryWorkspaceWorkflowDTO {
  message_id: number;
  result_type: "workflow_started" | "workflow_completed";
  scope_version: number;
  task_id: number;
  task_title: string;
  status: number;
  scope: "personal" | "team";
  saved: boolean;
  participant_count?: number;
  available_actions: SummaryWorkspaceAction[];
}

export interface SummaryWorkspaceStateDTO {
  scope_version: number;
  summary_context: SummaryWorkspaceContextDTO;
  current_preview: SummaryWorkspacePreviewDTO | null;
  pending_proposal: SummaryWorkspaceProposalDTO | null;
  workflow: SummaryWorkspaceWorkflowDTO | null;
}

export interface SummaryWorkspaceTurnDTO {
  contract_version: string;
  session_id: string;
  message_id: number;
  result_type: SummaryWorkspaceResultType;
  reply: string;
  scope_version: number;
  artifact_version?: number;
  run_id?: string;
  available_actions: SummaryWorkspaceAction[];
  state: SummaryWorkspaceStateDTO;
}

export interface SummaryWorkspaceHistoryMessageDTO {
  id: number;
  role: "user" | "assistant";
  content: string;
  result_type?: SummaryWorkspaceResultType;
  scope_version: number;
  artifact_version?: number;
  available_actions?: SummaryWorkspaceAction[];
}

export interface SummaryWorkspaceHistoryDTO {
  contract_version: string;
  session_id: string;
  messages: SummaryWorkspaceHistoryMessageDTO[];
  state: SummaryWorkspaceStateDTO;
}

export interface SummaryWorkspaceStreamHandlers {
  onProgress?: (event: AgentProgressEvent) => void;
  onDone?: (payload: unknown) => void;
  onError?: (event: unknown) => void;
}

export type SummaryWorkspaceErrorKind =
  | "business"
  | "transport"
  | "protocol"
  | "abort";

export class SummaryWorkspaceApiError extends Error {
  readonly kind: SummaryWorkspaceErrorKind;
  readonly code?: number | string;
  readonly httpStatus?: number;
  readonly detail?: string;
  readonly recoveryAction?: string;
  readonly taskId?: number;
  readonly retryable: boolean;

  constructor(options: {
    message: string;
    kind: SummaryWorkspaceErrorKind;
    code?: number | string;
    httpStatus?: number;
    detail?: string;
    recoveryAction?: string;
    taskId?: number;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "SummaryWorkspaceApiError";
    this.kind = options.kind;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.detail = options.detail;
    this.recoveryAction = options.recoveryAction;
    this.taskId = options.taskId;
    this.retryable = options.retryable ?? false;
  }
}

export function serializeSummaryWorkbenchScope(
  scope: SummaryWorkbenchScope
): SummaryWorkspaceContextDTO {
  return {
    selected_channels: scope.selectedChannels.map((channel) => ({
      chat_id: channel.chatId,
      chat_type: channel.chatType,
      name: channel.name,
      ...(channel.isArchived === undefined
        ? {}
        : { is_archived: channel.isArchived }),
    })),
    participants: scope.participants.map((participant) => ({
      user_id: participant.userId,
      ...(participant.userName ? { user_name: participant.userName } : {}),
    })),
    template: scope.template
      ? {
          template_id: scope.template.templateId,
          label: scope.template.label,
          requirement: scope.template.requirement,
          ...(scope.template.version === undefined
            ? {}
            : { version: scope.template.version }),
        }
      : null,
    time_range: scope.timeRange
      ? {
          start: scope.timeRange.start,
          end: scope.timeRange.end,
          label: scope.timeRange.label,
        }
      : null,
    referenced_task_ids: [...scope.referencedTaskIds],
  };
}
