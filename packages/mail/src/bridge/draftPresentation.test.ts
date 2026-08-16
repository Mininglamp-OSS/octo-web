import { describe, expect, it } from "vitest";
import type { MessageDetail } from "./types";
import { resolveDraftId, resolveDraftPresentation } from "./draftPresentation";
import { inferMailboxRole } from "./mailbox";

const message = (overrides: Partial<MessageDetail>): MessageDetail => ({
  id: "E1",
  mailbox: "\u6536\u4ef6\u7bb1",
  subject: "Status",
  from: "agent@example.com",
  to: ["owner@example.com"],
  preview: "Draft",
  receivedAt: "2026-08-10T10:00:00Z",
  size: 5,
  keywords: [],
  unread: false,
  ...overrides,
});

describe("draft presentation", () => {
  it("prefers explicit Draft metadata ids and falls back to the message id", () => {
    const policy = {
      outcome: "owner_review_required" as const,
      status: "pending_confirmation" as const,
      draftVersion: 2,
      policyVersion: "v1",
      reasons: [],
      source: "owner_direct" as const,
      draftId: "policy-draft",
      draftSubject: "Review",
    };
    const agentDraft = {
      outcome: "owner_confirmation_required" as const,
      status: "pending_confirmation" as const,
      draftType: "agent_pending_confirmation" as const,
      draftId: "agent-draft",
      draftSubject: "Review",
      draftVersion: 3,
    };

    expect(resolveDraftId(message({ policy, agentDraft }))).toBe("agent-draft");
    expect(resolveDraftId(message({ policy }))).toBe("policy-draft");
    expect(resolveDraftId(message({}))).toBe("E1");
  });

  it("recognizes an Agent draft from metadata regardless of mailbox name", () => {
    const agentDraft = {
      outcome: "owner_confirmation_required" as const,
      status: "pending_confirmation" as const,
      draftType: "agent_reply_draft" as const,
      draftId: "E1",
      draftSubject: "Status",
      draftVersion: 1,
    };

    expect(resolveDraftPresentation(message({ agentDraft }))).toEqual({
      isDraft: true,
      agentDraft,
      policyReview: undefined,
    });
  });

  it("recognizes a policy draft from metadata regardless of mailbox name", () => {
    const policy = {
      outcome: "owner_review_required" as const,
      status: "system_blocked" as const,
      draftVersion: 2,
      policyVersion: "v1",
      reasons: [],
      source: "inbound_auto_reply" as const,
      draftId: "E2",
      draftSubject: "Review",
    };

    expect(resolveDraftPresentation(message({ policy }))).toEqual({
      isDraft: true,
      agentDraft: undefined,
      policyReview: policy,
    });
  });

  it("uses the server mailbox role for an ordinary localized Draft", () => {
    expect(resolveDraftPresentation(message({}), "drafts").isDraft).toBe(true);
  });

  it("does not treat an ordinary message as a Draft from its name alone", () => {
    const mailboxRole = inferMailboxRole({
      id: "user-folder",
      name: "Draft planning discussion",
      total: 1,
      unread: 0,
    });
    expect(
      resolveDraftPresentation(
        message({ mailbox: "Draft planning discussion" }),
        mailboxRole
      ).isDraft
    ).toBe(false);
  });
});
