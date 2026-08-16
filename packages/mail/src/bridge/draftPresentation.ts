import type { MessageDetail } from "./types";
import type { MailboxRole } from "./mailbox";

export interface DraftPresentation {
  isDraft: boolean;
  agentDraft: MessageDetail["agentDraft"];
  policyReview: MessageDetail["policy"];
}

export function isDraftMessage(
  message: MessageDetail,
  mailboxRole?: MailboxRole
): boolean {
  return resolveDraftPresentation(message, mailboxRole).isDraft;
}

export function resolveDraftId(message?: MessageDetail | null): string {
  return (
    message?.agentDraft?.draftId ??
    message?.policy?.draftId ??
    message?.id ??
    ""
  );
}

export function resolveDraftPresentation(
  message?: MessageDetail | null,
  mailboxRole?: MailboxRole
): DraftPresentation {
  const agentDraft = message?.agentDraft;
  const policyReview = message?.policy;
  return {
    isDraft: Boolean(agentDraft || policyReview || mailboxRole === "drafts"),
    agentDraft,
    policyReview,
  };
}
