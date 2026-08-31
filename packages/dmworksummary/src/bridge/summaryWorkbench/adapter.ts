import type {
  CoverageGap,
  CreateAgentSummaryResult,
  FinishStatus,
} from "../../types/summary";
import type {
  CreateSummaryWorkbenchModelOptions,
  SummaryWorkbenchAuthoritativeState,
  SummaryWorkbenchMessage,
  SummaryWorkbenchResponse,
} from "./model";
import type {
  SummaryWorkbenchAction,
  SummaryWorkbenchContextItem,
  SummaryWorkbenchResultType,
} from "../../ui/SummaryWorkbench/types";
import {
  DEFAULT_SUMMARY_WORKSPACE_MAX_TIME_RANGE_DAYS,
  SUMMARY_WORKSPACE_CONTRACT_VERSION,
  SUMMARY_WORKSPACE_SNAPSHOT_VERSION,
  SummaryWorkspaceApiError,
  type SummaryWorkbenchScope,
  type SummaryWorkspaceAction,
  type SummaryWorkspaceCapabilitiesDTO,
  type SummaryWorkspaceChannelDTO,
  type SummaryWorkspaceContextDTO,
  type SummaryWorkspaceHistoryDTO,
  type SummaryWorkspaceHistoryMessageDTO,
  type SummaryWorkspaceParticipantDTO,
  type SummaryWorkspacePreviewDTO,
  type SummaryWorkspaceProposalDTO,
  type SummaryWorkspaceResultType,
  type SummaryWorkspaceStateDTO,
  type SummaryWorkspaceTurnDTO,
  type SummaryWorkspaceWorkflowDTO,
} from "./protocol";

type UnknownRecord = Record<string, unknown>;

export interface SummaryWorkbenchHistoryHydration {
  sessionId: string;
  contractVersion: string;
  scope: SummaryWorkbenchScope;
  modelOptions: CreateSummaryWorkbenchModelOptions;
}

export function adaptSummaryWorkspaceTurn(
  value: unknown
): SummaryWorkbenchResponse {
  const turn = decodeSummaryWorkspaceTurn(value);
  const actions = toWorkbenchActions(turn.available_actions);
  const common = {
    messageId: String(turn.message_id),
    reply: turn.reply,
    sessionId: turn.session_id,
    runId: turn.run_id,
    scopeVersion: turn.state.scope_version,
    authoritativeState: toAuthoritativeState(turn.state, {
      messageId: turn.message_id,
      actions,
    }),
  };

  switch (turn.result_type) {
    case "agent_preview":
    case "agent_revision": {
      const preview = requireCurrentPreview(turn);
      return {
        ...common,
        resultType: turn.result_type,
        availableActions: intersectActions(
          actions,
          toWorkbenchActions(preview.available_actions)
        ),
        preview: {
          version: preview.artifact_version,
          snapshotVersion: preview.snapshot_version,
          content: preview.content,
          assumptions: [...preview.assumptions],
        },
      };
    }
    case "workflow_confirmation": {
      const proposal = requirePendingProposal(turn);
      return {
        ...common,
        resultType: turn.result_type,
        availableActions: intersectActions(
          actions,
          toWorkbenchActions(proposal.available_actions)
        ),
        confirmation: {
          proposalVersion: proposal.proposal_version,
          proposalToken: proposal.proposal_token,
          participantNames: proposal.participants.map(
            (participant) => participant.user_name ?? participant.user_id
          ),
          requirement: proposal.requirement,
          templateLabel: proposal.template_label,
          timeRangeLabel: proposal.time_range_label,
        },
      };
    }
    case "workflow_started":
    case "workflow_completed": {
      const workflow = requireWorkflow(turn);
      return {
        ...common,
        resultType: turn.result_type,
        availableActions: intersectActions(
          actions,
          toWorkbenchActions(workflow.available_actions)
        ),
        workflow: {
          taskId: workflow.task_id,
          taskTitle: workflow.task_title,
          participantCount: workflow.participant_count,
          status: workflow.status,
          scope: workflow.scope,
          saved: workflow.saved,
        },
      };
    }
    case "clarification":
    case "explanation":
      return {
        ...common,
        resultType: turn.result_type,
        availableActions: actions,
      };
    case "error":
      return {
        ...common,
        resultType: turn.result_type,
        availableActions: [],
        errorMessage: turn.reply,
      };
  }
}

export function adaptSummaryWorkspaceHistory(
  value: unknown
): SummaryWorkbenchHistoryHydration {
  const history = decodeSummaryWorkspaceHistory(value);
  const authoritativeState = toAuthoritativeState(history.state);
  const scope = authoritativeState.scope;
  const currentPreview = history.state.current_preview;
  const pendingProposal = history.state.pending_proposal;
  const workflow = history.state.workflow;

  const artifactByMessageId = new Map<
    number,
    {
      resultType: SummaryWorkbenchResultType;
      scopeVersion: number;
      artifactVersion?: number;
      actions: SummaryWorkbenchAction[];
    }
  >();
  if (currentPreview) {
    artifactByMessageId.set(currentPreview.message_id, {
      resultType: currentPreview.result_type,
      scopeVersion: currentPreview.scope_version,
      artifactVersion: currentPreview.artifact_version,
      actions: toWorkbenchActions(currentPreview.available_actions),
    });
  }
  if (pendingProposal) {
    artifactByMessageId.set(pendingProposal.message_id, {
      resultType: "workflow_confirmation",
      scopeVersion: pendingProposal.scope_version,
      actions: toWorkbenchActions(pendingProposal.available_actions),
    });
  }
  if (workflow) {
    artifactByMessageId.set(workflow.message_id, {
      resultType: workflow.result_type,
      scopeVersion: workflow.scope_version,
      actions: toWorkbenchActions(workflow.available_actions),
    });
  }

  const messages = history.messages.map((message) => {
    const artifact = artifactByMessageId.get(message.id);
    const resultType = artifact?.resultType ?? message.result_type;
    const workbenchMessage: SummaryWorkbenchMessage = {
      id: String(message.id),
      role: message.role,
      content: message.content,
      resultType,
      scopeVersion: artifact?.scopeVersion ?? message.scope_version,
      availableActions:
        artifact?.actions ??
        toWorkbenchActions(message.available_actions ?? []),
    };
    return workbenchMessage;
  });

  for (const [artifactMessageId, artifact] of artifactByMessageId) {
    const message = history.messages.find(
      (candidate) => candidate.id === artifactMessageId
    );
    if (!message) {
      throw protocolError("History state references a missing message");
    }
    if (
      message.role !== "assistant" ||
      message.result_type !== artifact.resultType ||
      message.scope_version !== artifact.scopeVersion ||
      (artifact.artifactVersion !== undefined &&
        message.artifact_version !== artifact.artifactVersion)
    ) {
      throw protocolError(
        "History artifact metadata does not match its message"
      );
    }
  }

  return {
    sessionId: history.session_id,
    contractVersion: history.contract_version,
    scope,
    modelOptions: {
      scopeVersion: authoritativeState.scopeVersion,
      contextItems: authoritativeState.contextItems,
      messages,
      currentPreview: authoritativeState.currentPreview,
      pendingProposal: authoritativeState.pendingProposal,
      workflow: authoritativeState.workflow,
    },
  };
}

export function decodeSummaryWorkspaceCapabilities(
  value: unknown
): SummaryWorkspaceCapabilitiesDTO {
  const record = requireRecord(value, "capabilities");
  return {
    enabled: requireBoolean(record.enabled, "capabilities.enabled"),
    contract_version: requireContractVersion(
      record.contract_version,
      "capabilities.contract_version"
    ),
    max_time_range_days:
      record.max_time_range_days === undefined
        ? DEFAULT_SUMMARY_WORKSPACE_MAX_TIME_RANGE_DAYS
        : requirePositiveInteger(
            record.max_time_range_days,
            "capabilities.max_time_range_days"
          ),
  };
}

export function decodeSummaryWorkspaceTurn(
  value: unknown
): SummaryWorkspaceTurnDTO {
  const record = requireRecord(value, "turn");
  const state = decodeState(record.state, "turn.state");
  const resultType = requireResultType(record.result_type, "turn.result_type");
  const scopeVersion = requirePositiveInteger(
    record.scope_version,
    "turn.scope_version"
  );
  if (scopeVersion !== state.scope_version) {
    throw protocolError("Turn and state scope versions do not match");
  }
  return {
    contract_version: requireContractVersion(
      record.contract_version,
      "turn.contract_version"
    ),
    session_id: requireString(record.session_id, "turn.session_id"),
    message_id: requirePositiveInteger(record.message_id, "turn.message_id"),
    result_type: resultType,
    reply: requireString(record.reply, "turn.reply", true),
    scope_version: scopeVersion,
    artifact_version: optionalPositiveInteger(
      record.artifact_version,
      "turn.artifact_version"
    ),
    run_id: optionalString(record.run_id, "turn.run_id"),
    available_actions: decodeActions(
      record.available_actions,
      "turn.available_actions"
    ),
    state,
  };
}

export function decodeSummaryWorkspaceHistory(
  value: unknown
): SummaryWorkspaceHistoryDTO {
  const record = requireRecord(value, "history");
  const state = decodeState(record.state, "history.state");
  const rawMessages = requireArray(record.messages, "history.messages");
  return {
    contract_version: requireContractVersion(
      record.contract_version,
      "history.contract_version"
    ),
    session_id: requireString(record.session_id, "history.session_id"),
    messages: rawMessages.map((message, index) =>
      decodeHistoryMessage(message, `history.messages[${index}]`)
    ),
    state,
  };
}

export function decodeSummaryWorkspaceSaveResult(
  value: unknown
): CreateAgentSummaryResult {
  const record = requireRecord(value, "save_result");
  const finishStatus = decodeFinishStatus(record.finish_status);
  const gaps = decodeCoverageGaps(record.gaps);
  return {
    task_id: requirePositiveInteger(record.task_id, "save_result.task_id"),
    task_no: requireString(record.task_no, "save_result.task_no"),
    status: requireNonNegativeInteger(record.status, "save_result.status"),
    created_at: requireString(record.created_at, "save_result.created_at"),
    ...(finishStatus ? { finish_status: finishStatus } : {}),
    ...(gaps ? { gaps } : {}),
  };
}

export function decodeSummaryWorkspaceStreamError(
  value: unknown
): SummaryWorkspaceApiError {
  if (!isRecord(value)) {
    return protocolError("Summary workspace stream error must be an object");
  }
  const code = value.code;
  const message = value.message;
  const transient = value.transient;
  if (
    (typeof code !== "number" && typeof code !== "string") ||
    typeof message !== "string" ||
    message.trim() === "" ||
    (transient !== undefined && typeof transient !== "boolean")
  ) {
    return protocolError("Summary workspace stream error is invalid");
  }
  return new SummaryWorkspaceApiError({
    message,
    kind: transient ? "transport" : "business",
    code,
    retryable: transient ?? false,
  });
}

function decodeHistoryMessage(
  value: unknown,
  path: string
): SummaryWorkspaceHistoryMessageDTO {
  const record = requireRecord(value, path);
  const role = requireString(record.role, `${path}.role`);
  if (role !== "user" && role !== "assistant") {
    throw protocolError(`${path}.role is invalid`);
  }
  return {
    id: requirePositiveInteger(record.id, `${path}.id`),
    role,
    content: requireString(record.content, `${path}.content`, true),
    result_type:
      record.result_type === undefined || record.result_type === null
        ? undefined
        : requireResultType(record.result_type, `${path}.result_type`),
    scope_version: requirePositiveInteger(
      record.scope_version,
      `${path}.scope_version`
    ),
    artifact_version: optionalPositiveInteger(
      record.artifact_version,
      `${path}.artifact_version`
    ),
    available_actions:
      record.available_actions === undefined ||
      record.available_actions === null
        ? undefined
        : decodeActions(record.available_actions, `${path}.available_actions`),
  };
}

function decodeState(value: unknown, path: string): SummaryWorkspaceStateDTO {
  const record = requireRecord(value, path);
  return {
    scope_version: requirePositiveInteger(
      record.scope_version,
      `${path}.scope_version`
    ),
    summary_context: decodeContext(
      record.summary_context,
      `${path}.summary_context`
    ),
    current_preview:
      record.current_preview === null
        ? null
        : decodePreview(record.current_preview, `${path}.current_preview`),
    pending_proposal:
      record.pending_proposal === null
        ? null
        : decodeProposal(record.pending_proposal, `${path}.pending_proposal`),
    workflow:
      record.workflow === null
        ? null
        : decodeWorkflow(record.workflow, `${path}.workflow`),
  };
}

function decodeContext(
  value: unknown,
  path: string
): SummaryWorkspaceContextDTO {
  const record = requireRecord(value, path);
  const selectedChannels = requireArray(
    record.selected_channels,
    `${path}.selected_channels`
  ).map((channel, index): SummaryWorkspaceChannelDTO => {
    const channelPath = `${path}.selected_channels[${index}]`;
    const channelRecord = requireRecord(channel, channelPath);
    const chatType = requireString(
      channelRecord.chat_type,
      `${channelPath}.chat_type`
    );
    if (
      chatType !== "group" &&
      chatType !== "direct" &&
      chatType !== "thread"
    ) {
      throw protocolError(`${channelPath}.chat_type is invalid`);
    }
    return {
      chat_id: requireString(channelRecord.chat_id, `${channelPath}.chat_id`),
      chat_type: chatType,
      name: requireString(channelRecord.name, `${channelPath}.name`),
      is_archived: optionalBoolean(
        channelRecord.is_archived,
        `${channelPath}.is_archived`
      ),
    };
  });
  const participants = requireArray(
    record.participants,
    `${path}.participants`
  ).map((participant, index) =>
    decodeParticipant(participant, `${path}.participants[${index}]`)
  );
  const template =
    record.template === null
      ? null
      : (() => {
          const templateRecord = requireRecord(
            record.template,
            `${path}.template`
          );
          return {
            template_id: requireString(
              templateRecord.template_id,
              `${path}.template.template_id`
            ),
            label: requireString(
              templateRecord.label,
              `${path}.template.label`
            ),
            requirement: requireString(
              templateRecord.requirement,
              `${path}.template.requirement`
            ),
            version: optionalPositiveInteger(
              templateRecord.version,
              `${path}.template.version`
            ),
          };
        })();
  const timeRange =
    record.time_range === null
      ? null
      : (() => {
          const timeRangeRecord = requireRecord(
            record.time_range,
            `${path}.time_range`
          );
          return {
            start: requireString(
              timeRangeRecord.start,
              `${path}.time_range.start`
            ),
            end: requireString(timeRangeRecord.end, `${path}.time_range.end`),
            label: requireString(
              timeRangeRecord.label,
              `${path}.time_range.label`
            ),
          };
        })();
  const referencedTaskIds = requireArray(
    record.referenced_task_ids,
    `${path}.referenced_task_ids`
  ).map((taskId, index) =>
    requirePositiveInteger(taskId, `${path}.referenced_task_ids[${index}]`)
  );

  return {
    selected_channels: selectedChannels,
    participants,
    template,
    time_range: timeRange,
    referenced_task_ids: referencedTaskIds,
  };
}

function decodeParticipant(
  value: unknown,
  path: string
): SummaryWorkspaceParticipantDTO {
  const record = requireRecord(value, path);
  return {
    user_id: requireString(record.user_id, `${path}.user_id`),
    user_name: optionalString(record.user_name, `${path}.user_name`),
  };
}

function decodePreview(
  value: unknown,
  path: string
): SummaryWorkspacePreviewDTO {
  const record = requireRecord(value, path);
  const resultType = requireResultType(
    record.result_type,
    `${path}.result_type`
  );
  if (resultType !== "agent_preview" && resultType !== "agent_revision") {
    throw protocolError(`${path}.result_type is invalid`);
  }
  return {
    message_id: requirePositiveInteger(record.message_id, `${path}.message_id`),
    result_type: resultType,
    scope_version: requirePositiveInteger(
      record.scope_version,
      `${path}.scope_version`
    ),
    artifact_version: requirePositiveInteger(
      record.artifact_version,
      `${path}.artifact_version`
    ),
    snapshot_version: requireSnapshotVersion(
      record.snapshot_version,
      `${path}.snapshot_version`
    ),
    content: requireString(record.content, `${path}.content`),
    assumptions: decodeStringArray(record.assumptions, `${path}.assumptions`),
    available_actions: decodeActions(
      record.available_actions,
      `${path}.available_actions`
    ),
  };
}

function decodeProposal(
  value: unknown,
  path: string
): SummaryWorkspaceProposalDTO {
  const record = requireRecord(value, path);
  return {
    message_id: requirePositiveInteger(record.message_id, `${path}.message_id`),
    scope_version: requirePositiveInteger(
      record.scope_version,
      `${path}.scope_version`
    ),
    proposal_version: requirePositiveInteger(
      record.proposal_version,
      `${path}.proposal_version`
    ),
    proposal_token: requireString(
      record.proposal_token,
      `${path}.proposal_token`
    ),
    participants: requireArray(record.participants, `${path}.participants`).map(
      (participant, index) =>
        decodeParticipant(participant, `${path}.participants[${index}]`)
    ),
    requirement: requireString(record.requirement, `${path}.requirement`),
    template_label: optionalString(
      record.template_label,
      `${path}.template_label`
    ),
    time_range_label: optionalString(
      record.time_range_label,
      `${path}.time_range_label`
    ),
    available_actions: decodeActions(
      record.available_actions,
      `${path}.available_actions`
    ),
  };
}

function decodeWorkflow(
  value: unknown,
  path: string
): SummaryWorkspaceWorkflowDTO {
  const record = requireRecord(value, path);
  const resultType = requireResultType(
    record.result_type,
    `${path}.result_type`
  );
  if (
    resultType !== "workflow_started" &&
    resultType !== "workflow_completed"
  ) {
    throw protocolError(`${path}.result_type is invalid`);
  }
  const scope = requireString(record.scope, `${path}.scope`);
  if (scope !== "personal" && scope !== "team") {
    throw protocolError(`${path}.scope is invalid`);
  }
  const saved = requireBoolean(record.saved, `${path}.saved`);
  if (resultType === "workflow_completed" && !saved) {
    throw protocolError("A completed Workflow must be saved");
  }
  return {
    message_id: requirePositiveInteger(record.message_id, `${path}.message_id`),
    result_type: resultType,
    scope_version: requirePositiveInteger(
      record.scope_version,
      `${path}.scope_version`
    ),
    task_id: requirePositiveInteger(record.task_id, `${path}.task_id`),
    task_title: requireString(record.task_title, `${path}.task_title`),
    status: requireNonNegativeInteger(record.status, `${path}.status`),
    scope,
    saved,
    participant_count: optionalNonNegativeInteger(
      record.participant_count,
      `${path}.participant_count`
    ),
    available_actions: decodeActions(
      record.available_actions,
      `${path}.available_actions`
    ),
  };
}

function requireCurrentPreview(
  turn: SummaryWorkspaceTurnDTO
): SummaryWorkspacePreviewDTO {
  const preview = turn.state.current_preview;
  if (
    !preview ||
    preview.message_id !== turn.message_id ||
    preview.result_type !== turn.result_type ||
    preview.scope_version !== turn.scope_version ||
    (turn.artifact_version !== undefined &&
      preview.artifact_version !== turn.artifact_version)
  ) {
    throw protocolError("Preview state does not match the turn");
  }
  return preview;
}

function requirePendingProposal(
  turn: SummaryWorkspaceTurnDTO
): SummaryWorkspaceProposalDTO {
  const proposal = turn.state.pending_proposal;
  if (
    !proposal ||
    proposal.message_id !== turn.message_id ||
    proposal.scope_version !== turn.scope_version
  ) {
    throw protocolError("Proposal state does not match the turn");
  }
  return proposal;
}

function requireWorkflow(
  turn: SummaryWorkspaceTurnDTO
): SummaryWorkspaceWorkflowDTO {
  const workflow = turn.state.workflow;
  if (
    !workflow ||
    workflow.message_id !== turn.message_id ||
    workflow.result_type !== turn.result_type ||
    workflow.scope_version !== turn.scope_version
  ) {
    throw protocolError("Workflow state does not match the turn");
  }
  return workflow;
}

function toAuthoritativeState(
  state: SummaryWorkspaceStateDTO,
  turn?: { messageId: number; actions: SummaryWorkbenchAction[] }
): SummaryWorkbenchAuthoritativeState {
  const scope = toWorkbenchScope(state.summary_context);
  const constrainCurrentActions = (
    messageId: number,
    actions: SummaryWorkbenchAction[]
  ) =>
    turn?.messageId === messageId
      ? intersectActions(turn.actions, actions)
      : actions;

  return {
    scopeVersion: state.scope_version,
    scope,
    contextItems: contextItemsFromScope(scope),
    currentPreview: state.current_preview
      ? {
          messageId: String(state.current_preview.message_id),
          resultType: state.current_preview.result_type,
          scopeVersion: state.current_preview.scope_version,
          version: state.current_preview.artifact_version,
          snapshotVersion: state.current_preview.snapshot_version,
          content: state.current_preview.content,
          assumptions: [...state.current_preview.assumptions],
          availableActions: constrainCurrentActions(
            state.current_preview.message_id,
            toWorkbenchActions(state.current_preview.available_actions)
          ),
        }
      : null,
    pendingProposal: state.pending_proposal
      ? {
          messageId: String(state.pending_proposal.message_id),
          resultType: "workflow_confirmation",
          scopeVersion: state.pending_proposal.scope_version,
          proposalVersion: state.pending_proposal.proposal_version,
          proposalToken: state.pending_proposal.proposal_token,
          participantNames: state.pending_proposal.participants.map(
            (participant) => participant.user_name ?? participant.user_id
          ),
          requirement: state.pending_proposal.requirement,
          templateLabel: state.pending_proposal.template_label,
          timeRangeLabel: state.pending_proposal.time_range_label,
          availableActions: constrainCurrentActions(
            state.pending_proposal.message_id,
            toWorkbenchActions(state.pending_proposal.available_actions)
          ),
        }
      : null,
    workflow: state.workflow
      ? {
          messageId: String(state.workflow.message_id),
          resultType: state.workflow.result_type,
          scopeVersion: state.workflow.scope_version,
          taskId: state.workflow.task_id,
          taskTitle: state.workflow.task_title,
          participantCount: state.workflow.participant_count,
          status: state.workflow.status,
          scope: state.workflow.scope,
          saved: state.workflow.saved,
          availableActions: constrainCurrentActions(
            state.workflow.message_id,
            toWorkbenchActions(state.workflow.available_actions)
          ),
        }
      : null,
  };
}

function toWorkbenchScope(
  context: SummaryWorkspaceContextDTO
): SummaryWorkbenchScope {
  return {
    selectedChannels: context.selected_channels.map((channel) => ({
      chatId: channel.chat_id,
      chatType: channel.chat_type,
      name: channel.name,
      ...(channel.is_archived === undefined
        ? {}
        : { isArchived: channel.is_archived }),
    })),
    participants: context.participants.map((participant) => ({
      userId: participant.user_id,
      ...(participant.user_name ? { userName: participant.user_name } : {}),
    })),
    template: context.template
      ? {
          templateId: context.template.template_id,
          label: context.template.label,
          requirement: context.template.requirement,
          ...(context.template.version === undefined
            ? {}
            : { version: context.template.version }),
        }
      : null,
    timeRange: context.time_range
      ? {
          start: context.time_range.start,
          end: context.time_range.end,
          label: context.time_range.label,
        }
      : null,
    referencedTaskIds: [...context.referenced_task_ids],
  };
}

export function contextItemsFromScope(
  scope: SummaryWorkbenchScope
): SummaryWorkbenchContextItem[] {
  const items: SummaryWorkbenchContextItem[] = [];
  for (const channel of scope.selectedChannels) {
    items.push({
      id: channel.chatId,
      kind: "chat",
      label: channel.name,
    });
  }
  for (const participant of scope.participants) {
    items.push({
      id: participant.userId,
      kind: "participant",
      label: participant.userName ?? participant.userId,
    });
  }
  if (scope.template) {
    items.push({
      id: scope.template.templateId,
      kind: "template",
      label: scope.template.label,
    });
  }
  if (scope.timeRange) {
    items.push({
      id: `${scope.timeRange.start}:${scope.timeRange.end}`,
      kind: "time_range",
      label: scope.timeRange.label,
    });
  }
  for (const taskId of scope.referencedTaskIds) {
    items.push({
      id: String(taskId),
      kind: "reference",
      label: `#${taskId}`,
    });
  }
  return items;
}

function toWorkbenchActions(
  actions: SummaryWorkspaceAction[]
): SummaryWorkbenchAction[] {
  return actions.map((action) => action);
}

function intersectActions(
  left: SummaryWorkbenchAction[],
  right: SummaryWorkbenchAction[]
): SummaryWorkbenchAction[] {
  return left.filter((action) => right.includes(action));
}

function decodeActions(value: unknown, path: string): SummaryWorkspaceAction[] {
  const values = requireArray(value, path);
  const actions: SummaryWorkspaceAction[] = [];
  for (const candidate of values) {
    if (
      typeof candidate === "string" &&
      isSummaryWorkspaceAction(candidate) &&
      !actions.includes(candidate)
    ) {
      actions.push(candidate);
    }
  }
  return actions;
}

function decodeStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((item, index) =>
    requireString(item, `${path}[${index}]`, true)
  );
}

function decodeFinishStatus(value: unknown): FinishStatus | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== "COMPLETE" && value !== "PARTIAL" && value !== "FAILED") {
    throw protocolError("save_result.finish_status is invalid");
  }
  return value;
}

function decodeCoverageGaps(value: unknown): CoverageGap[] | undefined {
  if (value === undefined || value === null) return undefined;
  return requireArray(value, "save_result.gaps").map((gap, index) => {
    const path = `save_result.gaps[${index}]`;
    const record = requireRecord(gap, path);
    return {
      kind: requireString(record.kind, `${path}.kind`),
      detail: requireString(record.detail, `${path}.detail`),
      ...(record.error_code === undefined || record.error_code === null
        ? {}
        : {
            error_code: requireString(record.error_code, `${path}.error_code`),
          }),
    };
  });
}

function requireContractVersion(value: unknown, path: string): string {
  const version = requireString(value, path);
  if (version !== SUMMARY_WORKSPACE_CONTRACT_VERSION) {
    throw protocolError(
      `${path} must be ${SUMMARY_WORKSPACE_CONTRACT_VERSION}`
    );
  }
  return version;
}

function requireSnapshotVersion(
  value: unknown,
  path: string
): typeof SUMMARY_WORKSPACE_SNAPSHOT_VERSION {
  if (value !== SUMMARY_WORKSPACE_SNAPSHOT_VERSION) {
    throw protocolError(
      `${path} must be ${SUMMARY_WORKSPACE_SNAPSHOT_VERSION}`
    );
  }
  return SUMMARY_WORKSPACE_SNAPSHOT_VERSION;
}

function requireResultType(
  value: unknown,
  path: string
): SummaryWorkspaceResultType {
  const resultType = requireString(value, path);
  if (!isSummaryWorkspaceResultType(resultType)) {
    throw protocolError(`${path} is unknown`);
  }
  return resultType;
}

function isSummaryWorkspaceResultType(
  value: string
): value is SummaryWorkspaceResultType {
  switch (value) {
    case "clarification":
    case "explanation":
    case "workflow_confirmation":
    case "workflow_started":
    case "workflow_completed":
    case "agent_preview":
    case "agent_revision":
    case "error":
      return true;
    default:
      return false;
  }
}

function isSummaryWorkspaceAction(
  value: string
): value is SummaryWorkspaceAction {
  switch (value) {
    case "confirm_workflow":
    case "save_preview":
    case "view_summary":
    case "view_progress":
    case "continue_chat":
      return true;
    default:
      return false;
  }
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) throw protocolError(`${path} must be an object`);
  return value;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw protocolError(`${path} must be an array`);
  return value;
}

function requireString(
  value: unknown,
  path: string,
  allowEmpty = false
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw protocolError(`${path} must be a string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, path);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw protocolError(`${path} must be a boolean`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return requireBoolean(value, path);
}

function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw protocolError(`${path} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInteger(
  value: unknown,
  path: string
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requirePositiveInteger(value, path);
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw protocolError(`${path} must be a non-negative integer`);
  }
  return value;
}

function optionalNonNegativeInteger(
  value: unknown,
  path: string
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNonNegativeInteger(value, path);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolError(message: string): SummaryWorkspaceApiError {
  return new SummaryWorkspaceApiError({
    message,
    kind: "protocol",
    retryable: false,
  });
}
