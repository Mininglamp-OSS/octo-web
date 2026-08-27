import type {
  AgentProgressEvent,
  CreateAgentSummaryResult,
  SummaryDetail,
} from "../types/summary";
import {
  confirmSummaryWorkspaceProposal,
  getSummaryDetail,
  getSummaryWorkspaceCapabilities,
  getSummaryWorkspaceHistory,
  postSummaryWorkspaceTurn,
  saveSummaryWorkspacePreview,
  streamSummaryWorkspaceTurn,
} from "../api/summaryApi";
import {
  adaptSummaryWorkspaceHistory,
  adaptSummaryWorkspaceTurn,
  decodeSummaryWorkspaceCapabilities,
  decodeSummaryWorkspaceSaveResult,
  decodeSummaryWorkspaceStreamError,
  type SummaryWorkbenchHistoryHydration,
} from "../bridge/summaryWorkbench/adapter";
import type { SummaryWorkbenchResponse } from "../bridge/summaryWorkbench/model";
import {
  SUMMARY_WORKSPACE_PROFILE,
  SummaryWorkspaceApiError,
  serializeSummaryWorkbenchScope,
  type SummaryWorkbenchScope,
  type SummaryWorkspaceCapabilitiesDTO,
  type SummaryWorkspaceChatRequestDTO,
  type SummaryWorkspaceConfirmRequestDTO,
  type SummaryWorkspaceSavePreviewRequestDTO,
  type SummaryWorkspaceStreamHandlers,
} from "../bridge/summaryWorkbench/protocol";

export interface SummaryWorkbenchMessageInput {
  sessionId: string;
  message: string;
  requestId: string;
  scopeVersion: number;
  scope: SummaryWorkbenchScope;
}

export interface SummaryWorkbenchConfirmInput {
  sessionId: string;
  proposalVersion: number;
  proposalToken: string;
  scopeVersion: number;
  scope: SummaryWorkbenchScope;
  idempotencyKey: string;
}

export interface SummaryWorkbenchSaveInput {
  sessionId: string;
  messageId: string;
  snapshotVersion: number;
  scopeVersion: number;
  artifactVersion: number;
  idempotencyKey: string;
  title?: string;
  generationRequestId?: string;
}

export interface SummaryWorkbenchRequestOptions {
  signal?: AbortSignal;
}

export interface SummaryWorkbenchStreamCallbacks {
  onProgress?: (event: AgentProgressEvent) => void;
  onDone?: (response: SummaryWorkbenchResponse) => void;
  onError?: (error: SummaryWorkspaceApiError) => void;
}

export interface SummaryWorkbenchTransport {
  getCapabilities(options?: SummaryWorkbenchRequestOptions): Promise<unknown>;
  getSummaryDetail(taskId: number): Promise<SummaryDetail>;
  postTurn(
    request: SummaryWorkspaceChatRequestDTO,
    options?: SummaryWorkbenchRequestOptions
  ): Promise<unknown>;
  streamTurn(
    request: SummaryWorkspaceChatRequestDTO,
    handlers: SummaryWorkspaceStreamHandlers
  ): { close: () => void };
  getHistory(
    sessionId: string,
    options?: SummaryWorkbenchRequestOptions
  ): Promise<unknown>;
  confirmProposal(
    request: SummaryWorkspaceConfirmRequestDTO,
    options: SummaryWorkbenchRequestOptions & { idempotencyKey: string }
  ): Promise<unknown>;
  savePreview(
    request: SummaryWorkspaceSavePreviewRequestDTO,
    options: SummaryWorkbenchRequestOptions & { idempotencyKey: string }
  ): Promise<unknown>;
}

const defaultTransport: SummaryWorkbenchTransport = {
  getCapabilities: getSummaryWorkspaceCapabilities,
  getSummaryDetail,
  postTurn: postSummaryWorkspaceTurn,
  streamTurn: streamSummaryWorkspaceTurn,
  getHistory: getSummaryWorkspaceHistory,
  confirmProposal: confirmSummaryWorkspaceProposal,
  savePreview: saveSummaryWorkspacePreview,
};

export class SummaryWorkbenchService {
  constructor(
    private readonly transport: SummaryWorkbenchTransport = defaultTransport
  ) {}

  async getCapabilities(
    options: SummaryWorkbenchRequestOptions = {}
  ): Promise<SummaryWorkspaceCapabilitiesDTO> {
    const response = await this.transport.getCapabilities(options);
    return decodeSummaryWorkspaceCapabilities(response);
  }

  async loadReferenceSummary(
    taskId: number
  ): Promise<Pick<SummaryDetail, "task_id" | "title">> {
    const detail = await this.transport.getSummaryDetail(taskId);
    return { task_id: detail.task_id, title: detail.title };
  }

  async sendMessage(
    input: SummaryWorkbenchMessageInput,
    options: SummaryWorkbenchRequestOptions = {}
  ): Promise<SummaryWorkbenchResponse> {
    const response = await this.transport.postTurn(
      buildChatRequest(input),
      options
    );
    return adaptSummaryWorkspaceTurn(response);
  }

  streamMessage(
    input: SummaryWorkbenchMessageInput,
    callbacks: SummaryWorkbenchStreamCallbacks
  ): { close: () => void } {
    return this.transport.streamTurn(buildChatRequest(input), {
      onProgress: callbacks.onProgress,
      onDone: (payload) => {
        let response: SummaryWorkbenchResponse;
        try {
          response = adaptSummaryWorkspaceTurn(payload);
        } catch (error) {
          callbacks.onError?.(normalizeWorkspaceError(error));
          return;
        }
        callbacks.onDone?.(response);
      },
      onError: (event) => {
        const error = decodeSummaryWorkspaceStreamError(event);
        callbacks.onError?.(error);
      },
    });
  }

  async loadSession(
    sessionId: string,
    options: SummaryWorkbenchRequestOptions = {}
  ): Promise<SummaryWorkbenchHistoryHydration> {
    const response = await this.transport.getHistory(sessionId, options);
    return adaptSummaryWorkspaceHistory(response);
  }

  async confirmWorkflow(
    input: SummaryWorkbenchConfirmInput,
    options: SummaryWorkbenchRequestOptions = {}
  ): Promise<SummaryWorkbenchResponse> {
    const request: SummaryWorkspaceConfirmRequestDTO = {
      session_id: input.sessionId,
      proposal_version: input.proposalVersion,
      proposal_token: input.proposalToken,
      scope_version: input.scopeVersion,
      summary_context: serializeSummaryWorkbenchScope(input.scope),
    };
    const response = await this.transport.confirmProposal(request, {
      ...options,
      idempotencyKey: input.idempotencyKey,
    });
    return adaptSummaryWorkspaceTurn(response);
  }

  async savePreview(
    input: SummaryWorkbenchSaveInput,
    options: SummaryWorkbenchRequestOptions = {}
  ): Promise<CreateAgentSummaryResult> {
    const messageId = Number(input.messageId);
    if (!Number.isSafeInteger(messageId) || messageId <= 0) {
      throw new SummaryWorkspaceApiError({
        message: "Preview message id is invalid",
        kind: "protocol",
      });
    }
    const request: SummaryWorkspaceSavePreviewRequestDTO = {
      session_id: input.sessionId,
      agent_message_id: messageId,
      snapshot_version: input.snapshotVersion,
      scope_version: input.scopeVersion,
      expected_artifact_version: input.artifactVersion,
      ...(input.title ? { title: input.title } : {}),
      ...(input.generationRequestId
        ? { request_id: input.generationRequestId }
        : {}),
    };
    const response = await this.transport.savePreview(request, {
      ...options,
      idempotencyKey: input.idempotencyKey,
    });
    return decodeSummaryWorkspaceSaveResult(response);
  }
}

function buildChatRequest(
  input: SummaryWorkbenchMessageInput
): SummaryWorkspaceChatRequestDTO {
  return {
    session_id: input.sessionId,
    profile: SUMMARY_WORKSPACE_PROFILE,
    action: "chat",
    message: input.message,
    request_id: input.requestId,
    scope_version: input.scopeVersion,
    summary_context: serializeSummaryWorkbenchScope(input.scope),
  };
}

function normalizeWorkspaceError(error: unknown): SummaryWorkspaceApiError {
  if (error instanceof SummaryWorkspaceApiError) return error;
  return new SummaryWorkspaceApiError({
    message:
      error instanceof Error
        ? error.message
        : "Invalid summary workspace response",
    kind: "protocol",
    retryable: false,
  });
}

export default new SummaryWorkbenchService();
