export interface Mailbox {
  id: string;
  name: string;
  role?: "inbox" | "starred" | "sent" | "drafts" | "trash" | "junk" | "archive";
  total: number;
  unread: number;
}

export type DeliveryStatus =
  | "sending"
  | "delivered"
  | "partially_delivered"
  | "not_delivered";

export type RecipientDeliveryStatus = "sending" | "delivered" | "not_delivered";

export interface DeliverySummary {
  status: DeliveryStatus;
  delivered: number;
  total: number;
  updatedAt?: string;
}

export interface OutboundPolicyReason {
  code: string;
  title: string;
  description: string;
}

export interface OutboundPolicyInfo {
  outcome: "owner_review_required";
  status: "pending_confirmation" | "system_blocked";
  draftVersion: number;
  policyVersion: string;
  reasons: OutboundPolicyReason[];
  source: "owner_direct" | "inbound_auto_reply";
  sourceEmailId?: string;
  draftId: string;
  draftSubject: string;
}

export interface AgentDraftInfo {
  outcome: "owner_confirmation_required";
  status: "pending_confirmation" | "system_blocked";
  draftType: "agent_pending_confirmation" | "agent_reply_draft";
  draftId: string;
  draftSubject: string;
  senderAddress?: string;
  draftVersion: number;
  sourceEmailId?: string;
  threadId?: string;
}

export interface DeliveryRecipient {
  address: string;
  status: RecipientDeliveryStatus;
  reasonCode?: string;
  technicalDetail?: string;
  lastAttemptAt?: string;
  deliveredAt?: string;
}

export interface DeliveryDetail extends DeliverySummary {
  messageId: string;
  recipients: DeliveryRecipient[];
}

export interface MailIdentity {
  address: string;
}

export interface MailAddress {
  id: string;
  address: string;
  primary: boolean;
}

export type AgentMailboxConnectState =
  | "unconnected"
  | "connected"
  | "suspended";

export type AgentOutboundMode = "manual_confirmation" | "automatic_send";

export interface AgentMailbox {
  id: string;
  address: string;
  botId?: string;
  botProfile?: string;
  agentName?: string;
  connectState: AgentMailboxConnectState;
  outboundMode: AgentOutboundMode;
  /** @deprecated Compatibility projection during the local enum migration. */
  autoReplyEnabled?: boolean;
  deletable?: boolean;
}

export interface AgentAuthorizationRequest {
  userCode: string;
  botId: string;
  botProfile?: string;
  clientName?: string;
  status: "pending" | "approved" | "denied" | "exchanged";
  requestedAt: string;
  expiresAt: string;
  pollIntervalSeconds?: number;
  /**
   * Server-owned authorization-record mode. Device authorization creation
   * does not accept an outbound mode, and pending records default to manual
   * confirmation. Owner approval persists the selected mode to the same
   * record, so approved/exchanged reads expose the owner's actual grant here,
   * not an Agent-requested value.
   */
  outboundMode: AgentOutboundMode;
  /** @deprecated Compatibility projection during the local enum migration. */
  autoReplyEnabled?: boolean;
}

export interface AgentAuthorizationView {
  request: AgentAuthorizationRequest;
  mailboxes: AgentMailbox[];
}

export interface MailRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchMode: "all" | "any";
  conditions: MailRuleCondition[];
  matchFrom?: string;
  matchSubject?: string;
  forwardTargets: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MailRuleInput {
  name: string;
  enabled: boolean;
  priority: number;
  matchMode: "all" | "any";
  conditions: MailRuleCondition[];
  matchFrom?: string;
  matchSubject?: string;
  forwardTargets: string[];
}

export type MailRuleConditionField =
  | "from"
  | "to"
  | "subject"
  | "body"
  | "subject_or_body";

export type MailRuleConditionOperator = "contains" | "not_contains" | "equals";

export interface MailRuleCondition {
  field: MailRuleConditionField;
  operator: MailRuleConditionOperator;
  value: string;
}

export type MailRuleExecutionStatus =
  | "matched"
  | "queued"
  | "partially_queued"
  | "failed"
  | "loop_blocked";

export interface MailRuleTargetResult {
  address: string;
  status: string;
  queueId?: number;
}

export interface MailRuleExecution {
  id: string;
  ruleId: string;
  sourceEmailId: string;
  status: MailRuleExecutionStatus;
  targetResults: MailRuleTargetResult[];
  hopCount: number;
  errorCode?: string;
  createdAt: string;
  completedAt?: string;
}

export interface MessageSummary {
  id: string;
  threadId?: string;
  mailbox: string;
  subject: string;
  from: string;
  to: string[];
  preview: string;
  receivedAt: string;
  size: number;
  keywords: string[];
  unread: boolean;
  delivery?: DeliverySummary;
  policy?: OutboundPolicyInfo;
  agentDraft?: AgentDraftInfo;
}

export interface MessageDetail extends MessageSummary {
  cc?: string[];
  bcc?: string[];
  bodyText?: string;
  bodyHtml?: string;
  bodyTruncated?: boolean;
  originalFrom?: string;
  sentBy?: string;
  attachments?: ReceivedAttachment[];
  attachmentsTruncated?: boolean;
}

export interface ReceivedAttachment {
  partId: string;
  filename: string;
  contentType: string;
  disposition?: string;
  size: number;
}

export interface MessageListResponse {
  messages: MessageSummary[];
  total: number;
  offset: number;
  limit: number;
}

export interface ThreadResponse {
  id: string;
  messages: MessageSummary[];
}

export interface AttachmentInput {
  filename: string;
  contentType?: string;
  content: string;
}

export interface SendInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
}

export interface ReplyInput {
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
}

export interface ForwardInput extends ReplyInput {
  to: string[];
}

export interface SubmissionResponse {
  submissionIds: string[];
  messageId: string;
}

export interface DraftResponse {
  id: string;
}

export interface DraftUpdateResponse extends DraftResponse {
  draftVersion: number;
}

export type ComposeMode =
  | "new"
  | "reply"
  | "reply-all"
  | "forward"
  | "edit-draft";
