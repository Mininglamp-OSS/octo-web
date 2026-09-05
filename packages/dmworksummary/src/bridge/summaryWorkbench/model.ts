import type {
  SummaryWorkbenchAction,
  SummaryWorkbenchCardView,
  SummaryWorkbenchContextItem,
  SummaryWorkbenchMessageView,
  SummaryWorkbenchProcessView,
  SummaryWorkbenchResultType,
  SummaryWorkbenchViewState,
} from "../../ui/SummaryWorkbench/types";
import { visibleSummaryWorkbenchActions } from "../../ui/SummaryWorkbench/types";
import type { SummaryWorkbenchScope } from "./protocol";

export interface SummaryWorkbenchMessage extends SummaryWorkbenchMessageView {
  scopeVersion: number;
  availableActions: SummaryWorkbenchAction[];
}

export interface SummaryWorkbenchPreview {
  messageId: string;
  resultType: "agent_preview" | "agent_revision";
  scopeVersion: number;
  version: number;
  snapshotVersion: number;
  content: string;
  assumptions: string[];
  availableActions: SummaryWorkbenchAction[];
}

export interface SummaryWorkbenchProposal {
  messageId: string;
  resultType: "workflow_confirmation";
  scopeVersion: number;
  proposalVersion: number;
  proposalToken: string;
  participantNames: string[];
  requirement: string;
  templateLabel?: string;
  timeRangeLabel?: string;
  availableActions: SummaryWorkbenchAction[];
}

export interface SummaryWorkbenchWorkflow {
  messageId: string;
  resultType: "workflow_started" | "workflow_completed";
  scopeVersion: number;
  taskId: number;
  taskTitle: string;
  participantCount?: number;
  status?: number;
  scope?: "personal" | "team";
  saved?: boolean;
  availableActions: SummaryWorkbenchAction[];
}

export interface SummaryWorkbenchAuthoritativeState {
  scopeVersion: number;
  scope: SummaryWorkbenchScope;
  contextItems: SummaryWorkbenchContextItem[];
  currentPreview: SummaryWorkbenchPreview | null;
  pendingProposal: SummaryWorkbenchProposal | null;
  workflow: SummaryWorkbenchWorkflow | null;
}

export interface SummaryWorkbenchComposer {
  value: string;
  isSending: boolean;
  errorMessage?: string;
}

export interface SummaryWorkbenchModel {
  layout: "full" | "panel";
  scopeVersion: number;
  contextItems: SummaryWorkbenchContextItem[];
  messages: SummaryWorkbenchMessage[];
  currentPreview: SummaryWorkbenchPreview | null;
  pendingProposal: SummaryWorkbenchProposal | null;
  workflow: SummaryWorkbenchWorkflow | null;
  composer: SummaryWorkbenchComposer;
}

export interface CreateSummaryWorkbenchModelOptions {
  layout?: SummaryWorkbenchModel["layout"];
  scopeVersion?: number;
  contextItems?: SummaryWorkbenchContextItem[];
  messages?: SummaryWorkbenchMessage[];
  currentPreview?: SummaryWorkbenchPreview | null;
  pendingProposal?: SummaryWorkbenchProposal | null;
  workflow?: SummaryWorkbenchWorkflow | null;
  composer?: Partial<SummaryWorkbenchComposer>;
}

interface SummaryResponseBase {
  messageId: string;
  reply: string;
  sessionId?: string;
  runId?: string;
  scopeVersion?: number;
  availableActions?: SummaryWorkbenchAction[];
  authoritativeState: SummaryWorkbenchAuthoritativeState;
}

interface ConversationalSummaryResponse extends SummaryResponseBase {
  resultType: "clarification" | "explanation";
}

interface ErrorSummaryResponse extends SummaryResponseBase {
  resultType: "error";
  errorMessage?: string;
}

interface PreviewSummaryResponse extends SummaryResponseBase {
  resultType: "agent_preview" | "agent_revision";
  preview: {
    version: number;
    snapshotVersion: number;
    content: string;
    assumptions?: string[];
  };
}

interface TeamConfirmationSummaryResponse extends SummaryResponseBase {
  resultType: "workflow_confirmation";
  confirmation: {
    proposalVersion: number;
    proposalToken: string;
    participantNames: string[];
    requirement: string;
    templateLabel?: string;
    timeRangeLabel?: string;
  };
}

interface WorkflowSummaryResponse extends SummaryResponseBase {
  resultType: "workflow_started" | "workflow_completed";
  workflow: {
    taskId: number;
    taskTitle: string;
    participantCount?: number;
    status?: number;
    scope?: "personal" | "team";
    saved?: boolean;
  };
}

export type SummaryWorkbenchResponse =
  | ConversationalSummaryResponse
  | ErrorSummaryResponse
  | PreviewSummaryResponse
  | TeamConfirmationSummaryResponse
  | WorkflowSummaryResponse;

type SummaryWorkbenchModelResponse = SummaryWorkbenchResponse extends infer Response
  ? Response extends SummaryWorkbenchResponse
    ? Omit<Response, "authoritativeState"> & {
        authoritativeState?: SummaryWorkbenchAuthoritativeState;
      }
    : never
  : never;

export interface SummaryWorkbenchScopeUpdate {
  contextItems: SummaryWorkbenchContextItem[];
  /** Server-authoritative scope version, when one is already available. */
  scopeVersion?: number;
}

export type SummaryWorkbenchComposerUpdate =
  | string
  | Partial<SummaryWorkbenchComposer>;

const PREVIEW_TYPES = new Set<SummaryWorkbenchResultType>([
  "agent_preview",
  "agent_revision",
]);

const ARTIFACT_TYPES = new Set<SummaryWorkbenchResultType>([
  "workflow_confirmation",
  "workflow_started",
  "workflow_completed",
  "agent_preview",
  "agent_revision",
]);

export function createInitialSummaryWorkbenchModel(
  options: CreateSummaryWorkbenchModelOptions = {}
): SummaryWorkbenchModel {
  return {
    layout: options.layout ?? "full",
    scopeVersion: options.scopeVersion ?? 1,
    contextItems: [...(options.contextItems ?? [])],
    messages: [...(options.messages ?? [])],
    currentPreview: options.currentPreview
      ? clonePreview(options.currentPreview)
      : null,
    pendingProposal: options.pendingProposal
      ? cloneProposal(options.pendingProposal)
      : null,
    workflow: options.workflow ? cloneWorkflow(options.workflow) : null,
    composer: {
      value: options.composer?.value ?? "",
      isSending: options.composer?.isSending ?? false,
      ...(options.composer?.errorMessage
        ? { errorMessage: options.composer.errorMessage }
        : {}),
    },
  };
}

export function applySummaryResponse(
  model: SummaryWorkbenchModel,
  response: SummaryWorkbenchModelResponse
): SummaryWorkbenchModel {
  const responseScopeVersion = response.scopeVersion ?? model.scopeVersion;
  const availableActions = [...(response.availableActions ?? [])];
  const message: SummaryWorkbenchMessage = {
    id: response.messageId,
    role: "assistant",
    content: response.reply,
    resultType: response.resultType,
    scopeVersion: responseScopeVersion,
    availableActions,
  };

  const next: SummaryWorkbenchModel = {
    ...model,
    messages: [...model.messages, message],
    composer: {
      ...model.composer,
      isSending: false,
      errorMessage:
        response.resultType === "error"
          ? response.errorMessage ?? response.reply
          : undefined,
    },
  };

  let responseModel: SummaryWorkbenchModel;
  switch (response.resultType) {
    case "agent_preview":
    case "agent_revision":
      responseModel = {
        ...next,
        currentPreview: {
          messageId: response.messageId,
          resultType: response.resultType,
          scopeVersion: responseScopeVersion,
          version: response.preview.version,
          snapshotVersion: response.preview.snapshotVersion,
          content: response.preview.content,
          assumptions: [...(response.preview.assumptions ?? [])],
          availableActions,
        },
      };
      break;
    case "workflow_confirmation":
      responseModel = {
        ...next,
        pendingProposal: {
          messageId: response.messageId,
          resultType: response.resultType,
          scopeVersion: responseScopeVersion,
          proposalVersion: response.confirmation.proposalVersion,
          proposalToken: response.confirmation.proposalToken,
          participantNames: [...response.confirmation.participantNames],
          requirement: response.confirmation.requirement,
          templateLabel: response.confirmation.templateLabel,
          timeRangeLabel: response.confirmation.timeRangeLabel,
          availableActions,
        },
      };
      break;
    case "workflow_started":
    case "workflow_completed":
      responseModel = {
        ...next,
        pendingProposal: null,
        workflow: {
          messageId: response.messageId,
          resultType: response.resultType,
          scopeVersion: responseScopeVersion,
          taskId: response.workflow.taskId,
          taskTitle: response.workflow.taskTitle,
          participantCount: response.workflow.participantCount,
          status: response.workflow.status,
          scope: response.workflow.scope,
          saved: response.workflow.saved,
          availableActions,
        },
      };
      break;
    case "clarification":
    case "explanation":
    case "error":
      // Conversational replies never become artifacts and therefore do not
      // replace the latest preview, proposal, or workflow references.
      responseModel = next;
      break;
  }

  // The public response type requires authoritative state. Keep the runtime
  // guard for hand-written fixtures and defensive compatibility with stale JS.
  const synchronized = response.authoritativeState
    ? applySummaryAuthoritativeState(responseModel, response.authoritativeState)
    : responseModel;
  if (!ARTIFACT_TYPES.has(response.resultType)) return synchronized;
  const card = deriveActiveCard(synchronized);
  if (!card) return synchronized;
  return {
    ...synchronized,
    messages: synchronized.messages.map((candidate) =>
      candidate.id === response.messageId
        ? { ...candidate, card: cloneCard(card) }
        : candidate
    ),
  };
}

export function applySummaryAuthoritativeState(
  model: SummaryWorkbenchModel,
  state: SummaryWorkbenchAuthoritativeState
): SummaryWorkbenchModel {
  return {
    ...model,
    scopeVersion: state.scopeVersion,
    contextItems: [...state.contextItems],
    currentPreview: state.currentPreview
      ? clonePreview(state.currentPreview)
      : null,
    pendingProposal: state.pendingProposal
      ? cloneProposal(state.pendingProposal)
      : null,
    workflow: state.workflow ? cloneWorkflow(state.workflow) : null,
  };
}

export function markCurrentSummaryPreviewSaved(
  model: SummaryWorkbenchModel
): SummaryWorkbenchModel {
  const preview = model.currentPreview;
  if (!preview) return model;

  const withoutSave = (actions: SummaryWorkbenchAction[]) =>
    actions.filter((action) => action !== "save_preview");
  return {
    ...model,
    messages: model.messages.map((message) =>
      message.id === preview.messageId
        ? {
            ...message,
            availableActions: withoutSave(message.availableActions),
          }
        : message
    ),
    currentPreview: {
      ...preview,
      availableActions: withoutSave(preview.availableActions),
    },
  };
}

export function attachSummaryMessageProcess(
  model: SummaryWorkbenchModel,
  messageId: string,
  process: SummaryWorkbenchProcessView
): SummaryWorkbenchModel {
  return {
    ...model,
    messages: model.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            process: {
              status: process.status,
              steps: process.steps.map((step) => ({ ...step })),
            },
          }
        : message
    ),
  };
}

export function updateSummaryScope(
  model: SummaryWorkbenchModel,
  update: SummaryWorkbenchScopeUpdate
): SummaryWorkbenchModel {
  const contextItems = [...update.contextItems];
  const hasChanged = !sameContextItems(model.contextItems, contextItems);
  const minimumVersion = hasChanged
    ? model.scopeVersion + 1
    : model.scopeVersion;
  const scopeVersion =
    update.scopeVersion === undefined
      ? minimumVersion
      : Math.max(update.scopeVersion, minimumVersion);

  if (!hasChanged && scopeVersion === model.scopeVersion) return model;

  return {
    ...model,
    scopeVersion,
    contextItems,
  };
}

export function updateSummaryComposer(
  model: SummaryWorkbenchModel,
  update: SummaryWorkbenchComposerUpdate
): SummaryWorkbenchModel {
  const patch = typeof update === "string" ? { value: update } : update;
  return {
    ...model,
    composer: {
      ...model.composer,
      ...patch,
    },
  };
}

export function canSaveCurrentPreview(model: SummaryWorkbenchModel): boolean {
  const preview = model.currentPreview;
  const latestArtifactMessage = findLatestArtifactMessage(model.messages);
  return Boolean(
    preview &&
      latestArtifactMessage?.id === preview.messageId &&
      PREVIEW_TYPES.has(
        latestArtifactMessage.resultType as SummaryWorkbenchResultType
      ) &&
      PREVIEW_TYPES.has(preview.resultType) &&
      preview.snapshotVersion > 0 &&
      preview.scopeVersion === model.scopeVersion &&
      preview.availableActions.includes("save_preview")
  );
}

export function isTeamProposalConfirmable(
  model: SummaryWorkbenchModel
): boolean {
  const proposal = model.pendingProposal;
  const latestArtifactMessage = findLatestArtifactMessage(model.messages);
  return Boolean(
    proposal &&
      latestArtifactMessage?.id === proposal.messageId &&
      latestArtifactMessage.resultType === "workflow_confirmation" &&
      proposal.resultType === "workflow_confirmation" &&
      proposal.proposalToken.trim().length > 0 &&
      proposal.scopeVersion === model.scopeVersion &&
      proposal.availableActions.includes("confirm_workflow")
  );
}

export type SummaryScopeChangeImpact = "preview" | "team_proposal";

export function summaryScopeChangeImpact(
  model: SummaryWorkbenchModel
): SummaryScopeChangeImpact | null {
  if (canSaveCurrentPreview(model)) return "preview";
  if (isTeamProposalConfirmable(model)) return "team_proposal";
  return null;
}

export function deriveSummaryWorkbenchView(
  model: SummaryWorkbenchModel
): SummaryWorkbenchViewState {
  const activeCard = deriveActiveCard(model);
  const activeMessageId = activeArtifactMessageId(model);
  const messages = model.messages.map(
    ({ id, role, content, resultType, card, process }) => ({
      id,
      role,
      content,
      resultType,
      ...(process
        ? {
            process: {
              status: process.status,
              steps: process.steps.map((step) => ({ ...step })),
            },
          }
        : {}),
      ...(id === activeMessageId && activeCard
        ? { card: { ...cloneCard(activeCard), isHistorical: false } }
        : card
        ? { card: { ...cloneCard(card), actions: [], isHistorical: true } }
        : {}),
    })
  );
  return {
    layout: model.layout,
    messages,
    contextItems: [...model.contextItems],
    card: activeCard,
    inputValue: model.composer.value,
    placeholderKey: derivePlaceholderKey(model),
    isSending: model.composer.isSending,
    canSend:
      !model.composer.isSending && model.composer.value.trim().length > 0,
    errorMessage: model.composer.errorMessage,
  };
}

function activeArtifactMessageId(
  model: SummaryWorkbenchModel
): string | undefined {
  const latestArtifactType = findLatestArtifactType(model.messages);
  if (latestArtifactType === "workflow_confirmation") {
    return model.pendingProposal?.messageId;
  }
  if (
    latestArtifactType === "workflow_started" ||
    latestArtifactType === "workflow_completed"
  ) {
    return model.workflow?.messageId;
  }
  if (PREVIEW_TYPES.has(latestArtifactType as SummaryWorkbenchResultType)) {
    return model.currentPreview?.messageId;
  }
  return undefined;
}

function deriveActiveCard(
  model: SummaryWorkbenchModel
): SummaryWorkbenchCardView | undefined {
  const latestArtifactType = findLatestArtifactType(model.messages);

  if (latestArtifactType === "workflow_confirmation" && model.pendingProposal) {
    const proposal = model.pendingProposal;
    const isStale = proposal.scopeVersion !== model.scopeVersion;
    return {
      kind: "team_confirmation",
      participantNames: [...proposal.participantNames],
      requirement: proposal.requirement,
      templateLabel: proposal.templateLabel,
      timeRangeLabel: proposal.timeRangeLabel,
      isStale,
      actions: visibleSummaryWorkbenchActions(
        "team_confirmation",
        proposal.availableActions,
        isStale
      ),
    };
  }

  if (
    (latestArtifactType === "workflow_started" ||
      latestArtifactType === "workflow_completed") &&
    model.workflow
  ) {
    const workflow = model.workflow;
    return {
      kind: workflow.resultType,
      taskId: workflow.taskId,
      taskTitle: workflow.taskTitle,
      participantCount: workflow.participantCount,
      // A created workflow remains valid even if the user changes the
      // composer scope for a later request.
      isStale: false,
      actions: visibleSummaryWorkbenchActions(
        workflow.resultType,
        workflow.availableActions,
        false
      ),
    };
  }

  if (
    PREVIEW_TYPES.has(latestArtifactType as SummaryWorkbenchResultType) &&
    model.currentPreview
  ) {
    const preview = model.currentPreview;
    const isStale = preview.scopeVersion !== model.scopeVersion;
    return {
      kind: preview.resultType,
      version: preview.version,
      content: preview.content,
      assumptions: [...preview.assumptions],
      isStale,
      actions: visibleSummaryWorkbenchActions(
        preview.resultType,
        preview.availableActions,
        isStale || !canSaveCurrentPreview(model)
      ),
    };
  }

  return undefined;
}

function derivePlaceholderKey(model: SummaryWorkbenchModel): string {
  if (model.composer.isSending) return "summary.workbench.placeholder.sending";

  const latestArtifactType = findLatestArtifactType(model.messages);
  if (latestArtifactType === "workflow_confirmation" && model.pendingProposal) {
    return isTeamProposalConfirmable(model)
      ? "summary.workbench.placeholder.teamConfirmation"
      : "summary.workbench.placeholder.scopeChanged";
  }
  if (latestArtifactType === "workflow_started") {
    return "summary.workbench.placeholder.workflowRunning";
  }
  if (latestArtifactType === "workflow_completed") {
    return "summary.workbench.placeholder.workflowCompleted";
  }
  if (
    PREVIEW_TYPES.has(latestArtifactType as SummaryWorkbenchResultType) &&
    model.currentPreview
  ) {
    return canSaveCurrentPreview(model)
      ? "summary.workbench.placeholder.preview"
      : "summary.workbench.placeholder.scopeChanged";
  }

  const hasParticipants = model.contextItems.some(
    (item) => item.kind === "participant"
  );
  const hasChat = model.contextItems.some((item) => item.kind === "chat");
  const hasTemplate = model.contextItems.some(
    (item) => item.kind === "template"
  );
  if (hasParticipants)
    return "summary.workbench.placeholder.participantsSelected";
  if (hasChat && hasTemplate)
    return "summary.workbench.placeholder.structuredReady";
  if (hasChat) return "summary.workbench.placeholder.chatSelected";
  return "summary.workbench.placeholder.initial";
}

function findLatestArtifactType(
  messages: SummaryWorkbenchMessage[]
): SummaryWorkbenchResultType | undefined {
  return findLatestArtifactMessage(messages)?.resultType;
}

function findLatestArtifactMessage(
  messages: SummaryWorkbenchMessage[]
): SummaryWorkbenchMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.resultType && ARTIFACT_TYPES.has(message.resultType))
      return message;
  }
  return undefined;
}

function sameContextItems(
  left: SummaryWorkbenchContextItem[],
  right: SummaryWorkbenchContextItem[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const candidate = right[index];
    return (
      item.id === candidate.id &&
      item.kind === candidate.kind &&
      item.label === candidate.label
    );
  });
}

function clonePreview(
  preview: SummaryWorkbenchPreview
): SummaryWorkbenchPreview {
  return {
    ...preview,
    assumptions: [...preview.assumptions],
    availableActions: [...preview.availableActions],
  };
}

function cloneCard(card: SummaryWorkbenchCardView): SummaryWorkbenchCardView {
  switch (card.kind) {
    case "team_confirmation":
      return {
        ...card,
        participantNames: [...card.participantNames],
        actions: [...card.actions],
      };
    case "agent_preview":
    case "agent_revision":
      return {
        ...card,
        assumptions: [...card.assumptions],
        actions: [...card.actions],
      };
    case "workflow_started":
    case "workflow_completed":
      return { ...card, actions: [...card.actions] };
  }
}

function cloneProposal(
  proposal: SummaryWorkbenchProposal
): SummaryWorkbenchProposal {
  return {
    ...proposal,
    participantNames: [...proposal.participantNames],
    availableActions: [...proposal.availableActions],
  };
}

function cloneWorkflow(
  workflow: SummaryWorkbenchWorkflow
): SummaryWorkbenchWorkflow {
  return {
    ...workflow,
    availableActions: [...workflow.availableActions],
  };
}
