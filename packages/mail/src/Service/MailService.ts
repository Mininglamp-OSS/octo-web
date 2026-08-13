import APIClient from "@octo/base/src/Service/APIClient";
import type {
  AgentMailbox,
  AgentAuthorizationRequest,
  AgentAuthorizationView,
  AgentOutboundMode,
  DeliveryDetail,
  DraftResponse,
  DraftUpdateResponse,
  ForwardInput,
  MailAddress,
  MailIdentity,
  MailRule,
  MailRuleExecution,
  MailRuleInput,
  Mailbox,
  MessageDetail,
  MessageListResponse,
  ReplyInput,
  SendInput,
  SubmissionResponse,
  ThreadResponse,
} from "../bridge/types";

const ROOT_PATH = "/mail-api/webapi/v0";
const DIRECT_GATEWAY_PATH = "/v1/mail-gateway/webapi/v0";
export const MAIL_REQUEST_TIMEOUT_MS = 120_000;

type AgentMailboxWire = Omit<AgentMailbox, "outboundMode"> & {
  outboundMode?: string;
  autoReplyEnabled?: boolean;
};

export interface AgentMailboxRegistrationView {
  mailboxes: AgentMailbox[];
  registeredCount: number;
  maxMailboxes: number;
  addressDomain: string;
}

interface AgentMailboxRegistrationViewWire {
  mailboxes?: AgentMailboxWire[];
  registeredCount?: number;
  maxMailboxes?: number;
  addressDomain?: string;
}

type AgentAuthorizationRequestWire = Omit<
  AgentAuthorizationRequest,
  "outboundMode"
> & {
  outboundMode?: string;
  autoReplyEnabled?: boolean;
};

interface AgentAuthorizationViewWire {
  request: AgentAuthorizationRequestWire;
  mailboxes: AgentMailboxWire[];
}

function resolveOutboundMode(value: {
  outboundMode?: string;
  autoReplyEnabled?: boolean;
}): AgentOutboundMode {
  if (
    value.outboundMode === "manual_confirmation" ||
    value.outboundMode === "automatic_send"
  ) {
    return value.outboundMode;
  }
  return value.autoReplyEnabled === true
    ? "automatic_send"
    : "manual_confirmation";
}

function normalizeAgentMailbox(mailbox: AgentMailboxWire): AgentMailbox {
  return { ...mailbox, outboundMode: resolveOutboundMode(mailbox) };
}

function requireAgentMailbox(value: unknown): AgentMailbox {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Agent mailbox response");
  }
  const mailbox = value as Partial<AgentMailboxWire>;
  if (
    typeof mailbox.id !== "string" ||
    typeof mailbox.address !== "string" ||
    !["unconnected", "connected", "suspended"].includes(
      String(mailbox.connectState)
    )
  ) {
    throw new Error("Invalid Agent mailbox response");
  }
  return normalizeAgentMailbox(mailbox as AgentMailboxWire);
}

function requireAuthorizationApproval(value: unknown): {
  approved: boolean;
  mailboxId: string;
  outboundMode: AgentOutboundMode;
} {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Agent authorization response");
  }
  const approval = value as Record<string, unknown>;
  if (
    typeof approval.approved !== "boolean" ||
    typeof approval.mailboxId !== "string" ||
    (approval.outboundMode !== "manual_confirmation" &&
      approval.outboundMode !== "automatic_send")
  ) {
    throw new Error("Invalid Agent authorization response");
  }
  return {
    approved: approval.approved,
    mailboxId: approval.mailboxId,
    outboundMode: approval.outboundMode,
  };
}

function requireDraftUpdateResponse(value: unknown): DraftUpdateResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Draft update response");
  }
  const draft = value as Partial<DraftUpdateResponse>;
  if (
    typeof draft.id !== "string" ||
    draft.id.trim() === "" ||
    !Number.isInteger(draft.draftVersion) ||
    (draft.draftVersion ?? 0) <= 0
  ) {
    throw new Error("Invalid Draft update response");
  }
  return draft as DraftUpdateResponse;
}

// APIClient has a global baseURL for the OCTO server. Mail requests must use an
// absolute same-origin URL so axios does not prepend that baseURL to /mail-api.
export function resolveMailApiRoot(
  pageOrigin?: string,
  configuredApiUrl?: string
): string {
  const usablePageOrigin =
    pageOrigin && pageOrigin !== "null" && /^https?:\/\//i.test(pageOrigin)
      ? pageOrigin
      : "";
  if (usablePageOrigin) return new URL(ROOT_PATH, usablePageOrigin).toString();

  const configured = configuredApiUrl?.trim();
  if (configured && /^https?:\/\//i.test(configured)) {
    return new URL(DIRECT_GATEWAY_PATH, configured).toString();
  }
  return ROOT_PATH;
}

function mailApiUrl(path = ""): string {
  const origin =
    typeof window === "undefined" ? undefined : window.location.origin;
  return `${resolveMailApiRoot(origin, APIClient.shared.config.apiURL)}${path}`;
}

export interface ListMessageParams {
  mailboxContextId: string;
  mailbox?: string;
  search?: string;
  unread?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

function mailboxContextConfig(
  mailboxContextId: string,
  config: {
    param?: Record<string, unknown>;
    responseType?: "blob";
    signal?: AbortSignal;
    timeout?: number;
  } = {}
) {
  return {
    ...config,
    timeout: config.timeout ?? MAIL_REQUEST_TIMEOUT_MS,
    headers: { "X-Octo-Mailbox-ID": mailboxContextId },
  };
}

const MailService = {
  getIdentity(mailboxContextId: string): Promise<MailIdentity> {
    return APIClient.shared.get<MailIdentity>(
      mailApiUrl("/identity"),
      mailboxContextConfig(mailboxContextId)
    );
  },

  async listAddresses(mailboxContextId: string): Promise<MailAddress[]> {
    const response = await APIClient.shared.get<{ addresses: MailAddress[] }>(
      mailApiUrl("/addresses"),
      mailboxContextConfig(mailboxContextId)
    );
    return response.addresses ?? [];
  },

  createAddress(
    mailboxContextId: string,
    localpart: string
  ): Promise<MailAddress> {
    return APIClient.shared.post(
      mailApiUrl("/addresses"),
      { localpart },
      mailboxContextConfig(mailboxContextId)
    );
  },

  deleteAddress(mailboxContextId: string, id: string): Promise<void> {
    return APIClient.shared.delete(
      mailApiUrl(`/addresses/${encodeURIComponent(id)}`),
      mailboxContextConfig(mailboxContextId)
    );
  },

  async getAgentMailboxRegistrationView(): Promise<AgentMailboxRegistrationView> {
    const response =
      await APIClient.shared.get<AgentMailboxRegistrationViewWire>(
        mailApiUrl("/agent-mailboxes")
      );
    const mailboxes = (response.mailboxes ?? []).map(normalizeAgentMailbox);
    if (
      !Number.isInteger(response.maxMailboxes) ||
      (response.maxMailboxes ?? 0) <= 0
    ) {
      throw new Error("Invalid Agent mailbox registration response");
    }
    return {
      mailboxes,
      registeredCount: Number.isInteger(response.registeredCount)
        ? response.registeredCount!
        : mailboxes.length,
      maxMailboxes: response.maxMailboxes!,
      addressDomain:
        response.addressDomain?.trim() ||
        mailboxes[0]?.address.split("@").pop() ||
        "",
    };
  },

  async listAgentMailboxes(): Promise<AgentMailbox[]> {
    return (await this.getAgentMailboxRegistrationView()).mailboxes;
  },

  async createAgentMailbox(localpart: string): Promise<AgentMailbox> {
    const mailbox = await APIClient.shared.post(
      mailApiUrl("/agent-mailboxes"),
      {
        localpart,
      }
    );
    return requireAgentMailbox(mailbox);
  },

  async getAgentAuthorization(
    code: string,
    spaceId: string
  ): Promise<AgentAuthorizationView> {
    const view = await APIClient.shared.get<AgentAuthorizationViewWire>(
      mailApiUrl(`/agent-auth/requests/${encodeURIComponent(code)}`),
      {
        headers: { "X-Space-ID": spaceId },
        suppressAuthExpiredLogout: true,
      }
    );
    return {
      request: {
        ...view.request,
        outboundMode: resolveOutboundMode(view.request),
      },
      mailboxes: (view.mailboxes ?? []).map(normalizeAgentMailbox),
    };
  },

  async approveAgentAuthorization(
    code: string,
    mailboxId: string,
    outboundMode: AgentOutboundMode,
    spaceId: string
  ): Promise<{
    approved: boolean;
    mailboxId: string;
    outboundMode: AgentOutboundMode;
  }> {
    const approval = await APIClient.shared.post(
      mailApiUrl(`/agent-auth/requests/${encodeURIComponent(code)}/approve`),
      { mailboxId, outboundMode },
      {
        headers: { "X-Space-ID": spaceId },
        suppressAuthExpiredLogout: true,
      }
    );
    return requireAuthorizationApproval(approval);
  },

  revokeAgentMailboxBinding(id: string): Promise<void> {
    return APIClient.shared.delete(
      mailApiUrl(`/agent-mailboxes/${encodeURIComponent(id)}/binding`)
    );
  },

  deleteAgentMailbox(id: string): Promise<void> {
    return APIClient.shared.delete(
      mailApiUrl(`/agent-mailboxes/${encodeURIComponent(id)}`)
    );
  },

  async updateAgentMailboxAutomation(
    id: string,
    outboundMode: AgentOutboundMode
  ): Promise<AgentMailbox> {
    const mailbox = await APIClient.shared.patch(
      mailApiUrl(`/agent-mailboxes/${encodeURIComponent(id)}/automation`),
      { outboundMode }
    );
    return requireAgentMailbox(mailbox);
  },

  async listMailRules(mailboxId: string): Promise<MailRule[]> {
    const response = await APIClient.shared.get<{ rules: MailRule[] }>(
      mailApiUrl(`/agent-mailboxes/${encodeURIComponent(mailboxId)}/rules`)
    );
    return response.rules ?? [];
  },

  createMailRule(mailboxId: string, input: MailRuleInput): Promise<MailRule> {
    return APIClient.shared.post(
      mailApiUrl(`/agent-mailboxes/${encodeURIComponent(mailboxId)}/rules`),
      input
    );
  },

  updateMailRule(
    mailboxId: string,
    ruleId: string,
    input: Partial<MailRuleInput>
  ): Promise<MailRule> {
    return APIClient.shared.patch(
      mailApiUrl(
        `/agent-mailboxes/${encodeURIComponent(
          mailboxId
        )}/rules/${encodeURIComponent(ruleId)}`
      ),
      input
    );
  },

  deleteMailRule(mailboxId: string, ruleId: string): Promise<void> {
    return APIClient.shared.delete(
      mailApiUrl(
        `/agent-mailboxes/${encodeURIComponent(
          mailboxId
        )}/rules/${encodeURIComponent(ruleId)}`
      )
    );
  },

  async listMailRuleExecutions(
    mailboxId: string,
    limit = 20
  ): Promise<MailRuleExecution[]> {
    const response = await APIClient.shared.get<{
      executions: MailRuleExecution[];
    }>(
      mailApiUrl(
        `/agent-mailboxes/${encodeURIComponent(mailboxId)}/rule-executions`
      ),
      { param: { limit } }
    );
    return response.executions ?? [];
  },

  async listMailboxes(mailboxContextId: string): Promise<Mailbox[]> {
    const response = await APIClient.shared.get<{ mailboxes: Mailbox[] }>(
      mailApiUrl("/mailboxes"),
      mailboxContextConfig(mailboxContextId)
    );
    return response.mailboxes ?? [];
  },

  listMessages(params: ListMessageParams): Promise<MessageListResponse> {
    return APIClient.shared.get<MessageListResponse>(mailApiUrl("/messages"), {
      param: {
        mailbox: params.mailbox || undefined,
        search: params.search || undefined,
        unread: params.unread ? true : undefined,
        limit: params.limit ?? 30,
        offset: params.offset ?? 0,
      },
      headers: { "X-Octo-Mailbox-ID": params.mailboxContextId },
      signal: params.signal,
      timeout: MAIL_REQUEST_TIMEOUT_MS,
    });
  },

  getMessage(mailboxContextId: string, id: string): Promise<MessageDetail> {
    return APIClient.shared.get<MessageDetail>(
      mailApiUrl(`/messages/${encodeURIComponent(id)}`),
      mailboxContextConfig(mailboxContextId)
    );
  },

  getThread(mailboxContextId: string, id: string): Promise<ThreadResponse> {
    return APIClient.shared.get<ThreadResponse>(
      mailApiUrl(`/threads/${encodeURIComponent(id)}`),
      mailboxContextConfig(mailboxContextId)
    );
  },

  getMessageDelivery(
    mailboxContextId: string,
    id: string
  ): Promise<DeliveryDetail> {
    return APIClient.shared.get<DeliveryDetail>(
      mailApiUrl(`/messages/${encodeURIComponent(id)}/delivery`),
      mailboxContextConfig(mailboxContextId)
    );
  },

  sendMessage(
    mailboxContextId: string,
    input: SendInput
  ): Promise<SubmissionResponse> {
    return APIClient.shared.post(
      mailApiUrl("/messages"),
      input,
      mailboxContextConfig(mailboxContextId)
    );
  },

  reply(
    mailboxContextId: string,
    id: string,
    input: ReplyInput
  ): Promise<SubmissionResponse> {
    return APIClient.shared.post(
      mailApiUrl(`/messages/${encodeURIComponent(id)}/reply`),
      input,
      mailboxContextConfig(mailboxContextId)
    );
  },

  replyAll(
    mailboxContextId: string,
    id: string,
    input: ReplyInput
  ): Promise<SubmissionResponse> {
    return APIClient.shared.post(
      mailApiUrl(`/messages/${encodeURIComponent(id)}/reply-all`),
      input,
      mailboxContextConfig(mailboxContextId)
    );
  },

  forward(
    mailboxContextId: string,
    id: string,
    input: ForwardInput
  ): Promise<SubmissionResponse> {
    return APIClient.shared.post(
      mailApiUrl(`/messages/${encodeURIComponent(id)}/forward`),
      input,
      mailboxContextConfig(mailboxContextId)
    );
  },

  updateKeywords(
    mailboxContextId: string,
    id: string,
    addKeywords: string[] = [],
    removeKeywords: string[] = []
  ): Promise<{ updated: string }> {
    return APIClient.shared.patch(
      mailApiUrl(`/messages/${encodeURIComponent(id)}`),
      { addKeywords, removeKeywords },
      mailboxContextConfig(mailboxContextId)
    );
  },

  deleteMessage(mailboxContextId: string, id: string): Promise<void> {
    return APIClient.shared.delete(
      mailApiUrl(`/messages/${encodeURIComponent(id)}`),
      mailboxContextConfig(mailboxContextId)
    );
  },

  getRawMessage(mailboxContextId: string, id: string): Promise<Blob> {
    return APIClient.shared.get(
      mailApiUrl(`/messages/${encodeURIComponent(id)}/raw`),
      mailboxContextConfig(mailboxContextId, { responseType: "blob" })
    );
  },

  downloadAttachment(
    mailboxContextId: string,
    id: string,
    partId: string
  ): Promise<Blob> {
    return APIClient.shared.get(
      mailApiUrl(
        `/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(
          partId
        )}`
      ),
      mailboxContextConfig(mailboxContextId, { responseType: "blob" })
    );
  },

  sendDraft(
    mailboxContextId: string,
    id: string,
    draftVersion?: number
  ): Promise<SubmissionResponse> {
    return APIClient.shared.post(
      mailApiUrl(`/drafts/${encodeURIComponent(id)}/send`),
      draftVersion === undefined ? undefined : { draftVersion },
      mailboxContextConfig(mailboxContextId)
    );
  },

  async updateDraft(
    mailboxContextId: string,
    id: string,
    input: SendInput & { draftVersion?: number }
  ): Promise<DraftUpdateResponse> {
    const response = await APIClient.shared.patch(
      mailApiUrl(`/drafts/${encodeURIComponent(id)}`),
      input,
      mailboxContextConfig(mailboxContextId)
    );
    return requireDraftUpdateResponse(response);
  },

  createDraft(
    mailboxContextId: string,
    input: SendInput
  ): Promise<DraftResponse> {
    return APIClient.shared.post(
      mailApiUrl("/drafts"),
      input,
      mailboxContextConfig(mailboxContextId)
    );
  },
};

export default MailService;
