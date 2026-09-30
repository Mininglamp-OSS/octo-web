import { describe, expect, it } from "vitest";
import {
  canSelectParticipants,
  canGenerateFromScope,
  chatCandidatesToScope,
  documentsToScope,
  emptySummaryWorkbenchScope,
  participantSourceChannels,
  participantSourceKey,
  removeScopeContext,
  replaceSelectedChannels,
  replaceSelectedDocuments,
  retainValidParticipants,
} from "./scope";

describe("summary workbench scope helpers", () => {
  it("never offers a participant source for documents, even with no channels", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      documents: [{ documentId: "doc-a", title: "A" }],
      participants: [{ userId: "u1" }],
    };
    expect(canSelectParticipants(scope)).toBe(false);
    expect(participantSourceKey(scope)).toBeUndefined();
    expect(participantSourceKey(emptySummaryWorkbenchScope())).toBe("space");
  });

  it("keeps document scope intact on an empty chat confirmation", () => {
    const scope = { ...emptySummaryWorkbenchScope(), documents: [{ documentId: "doc-a", title: "A" }] };
    const result = replaceSelectedChannels(scope, []);
    expect(result.scope).toBe(scope);
    expect(result.participantsCleared).toBe(false);
  });

  it("keeps chats, participants and time range on an empty document confirmation", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      selectedChannels: [{ chatId: "group-a", chatType: "group" as const, name: "A" }],
      participants: [{ userId: "u1" }],
      timeRange: { start: "2026-09-01", end: "2026-09-02", label: "Range" },
    };
    expect(replaceSelectedDocuments(scope, [])).toEqual({ scope, participantsCleared: false });
    expect(replaceSelectedDocuments(scope, []).scope).toBe(scope);
  });

  it("still clears all selections of the current source type", () => {
    const scope = emptySummaryWorkbenchScope();
    expect(replaceSelectedChannels({
      ...scope, selectedChannels: [{ chatId: "a", chatType: "group", name: "A" }],
    }, []).scope.selectedChannels).toEqual([]);
    expect(replaceSelectedDocuments({
      ...scope, documents: [{ documentId: "a", title: "A" }],
    }, []).scope.documents).toEqual([]);
  });

  it("maps chat candidates without losing archived state", () => {
    expect(
      chatCandidatesToScope([
        {
          chat_id: "thread-1",
          chat_type: "thread",
          name: "Launch",
          member_count: 8,
          is_archived: true,
        },
      ])
    ).toEqual([
      {
        chatId: "thread-1",
        chatType: "thread",
        name: "Launch",
        isArchived: true,
      },
    ]);
  });

  it("keeps participants until the changed group union is revalidated", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      selectedChannels: [
        { chatId: "chat-a", chatType: "group" as const, name: "A" },
      ],
      participants: [{ userId: "user-a", userName: "Alex" }],
    };

    const result = replaceSelectedChannels(scope, [
      { chatId: "chat-b", chatType: "group", name: "B" },
    ]);
    expect(result.participantsCleared).toBe(false);
    expect(result.scope.participants).toEqual(scope.participants);
  });

  it("keeps workspace participants when the chat selection remains empty", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      participants: [{ userId: "user-a", userName: "Alex" }],
    };

    const result = replaceSelectedChannels(scope, []);
    expect(result.participantsCleared).toBe(false);
    expect(result.scope.participants).toEqual(scope.participants);
  });

  it("allows participant selection globally or from up to thirty group chats", () => {
    const emptyScope = emptySummaryWorkbenchScope();
    expect(canSelectParticipants(emptyScope)).toBe(true);
    expect(
      canSelectParticipants({
        ...emptyScope,
        selectedChannels: [{ chatId: "group-a", chatType: "group", name: "A" }],
      })
    ).toBe(true);
    expect(
      canSelectParticipants({
        ...emptyScope,
        selectedChannels: [
          { chatId: "direct-a", chatType: "direct", name: "A" },
        ],
      })
    ).toBe(false);
    expect(
      canSelectParticipants({
        ...emptyScope,
        selectedChannels: Array.from({ length: 30 }, (_, index) => ({
          chatId: `group-${index}`,
          chatType: "group" as const,
          name: `Group ${index}`,
        })),
      })
    ).toBe(true);
    expect(
      canSelectParticipants({
        ...emptyScope,
        selectedChannels: Array.from({ length: 31 }, (_, index) => ({
          chatId: `group-${index}`,
          chatType: "group" as const,
          name: `Group ${index}`,
        })),
      })
    ).toBe(false);
  });

  it("returns every selected group as a participant source", () => {
    const emptyScope = emptySummaryWorkbenchScope();
    const sources = participantSourceChannels({
      ...emptyScope,
      selectedChannels: [
        { chatId: "group-a", chatType: "group", name: "A" },
        { chatId: "group-b", chatType: "group", name: "B" },
      ],
    });
    expect(sources?.map((source) => source.chatId)).toEqual([
      "group-a",
      "group-b",
    ]);

    expect(
      participantSourceChannels({
        ...emptyScope,
        selectedChannels: [
          { chatId: "group-a", chatType: "group", name: "A" },
          { chatId: "direct-a", chatType: "direct", name: "B" },
        ],
      })
    ).toBeNull();
  });

  it("clears participants when selected sources include a non-group chat", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      selectedChannels: [
        { chatId: "group-a", chatType: "group" as const, name: "A" },
      ],
      participants: [{ userId: "user-a", userName: "Alex" }],
    };

    const result = replaceSelectedChannels(scope, [
      { chatId: "group-a", chatType: "group", name: "A" },
      { chatId: "direct-b", chatType: "direct", name: "B" },
    ]);
    expect(result.participantsCleared).toBe(true);
    expect(result.scope.participants).toEqual([]);
  });

  it("keeps only participants that remain in the new group-member union", () => {
    const current = {
      ...emptySummaryWorkbenchScope(),
      participants: [
        { userId: "still-valid", userName: "Valid" },
        { userId: "removed", userName: "Removed" },
      ],
    };

    const result = retainValidParticipants(current, [
      { uid: "still-valid", name: "Valid" },
      { uid: "new-candidate", name: "New" },
    ]);

    expect(result.removedCount).toBe(1);
    expect(result.scope.participants).toEqual([
      { userId: "still-valid", userName: "Valid" },
    ]);
  });

  it("applies the final start gate across chat, participant, template, and user input", () => {
    const scope = emptySummaryWorkbenchScope();
    expect(canGenerateFromScope(scope)).toBe(false);
    expect(canGenerateFromScope(scope, true)).toBe(true);
    expect(
      canGenerateFromScope({
        ...scope,
        selectedChannels: [{ chatId: "chat-a", chatType: "group", name: "A" }],
      })
    ).toBe(true);
    expect(
      canGenerateFromScope({
        ...scope,
        documents: [{ documentId: "doc-a", title: "Doc A" }],
      })
    ).toBe(true);
    expect(
      canGenerateFromScope({
        ...scope,
        participants: [{ userId: "user-a", userName: "Alex" }],
      })
    ).toBe(false);
    expect(
      canGenerateFromScope(
        {
          ...scope,
          participants: [{ userId: "user-a", userName: "Alex" }],
        },
        true
      )
    ).toBe(true);
    expect(
      canGenerateFromScope({
        ...scope,
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress",
        },
      })
    ).toBe(true);
    expect(
      canGenerateFromScope({
        ...scope,
        selectedChannels: [{ chatId: "chat-a", chatType: "group", name: "A" }],
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress",
        },
      })
    ).toBe(true);
    expect(
      canGenerateFromScope({
        ...scope,
        selectedChannels: [{ chatId: "chat-a", chatType: "group", name: "A" }],
        participants: [{ userId: "user-a", userName: "Alex" }],
      })
    ).toBe(false);
    expect(
      canGenerateFromScope({
        ...scope,
        participants: [{ userId: "user-a", userName: "Alex" }],
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress",
        },
      })
    ).toBe(true);
    expect(
      canGenerateFromScope({
        ...scope,
        selectedChannels: [{ chatId: "chat-a", chatType: "group", name: "A" }],
        participants: [{ userId: "user-a", userName: "Alex" }],
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress",
        },
      })
    ).toBe(true);
  });

  it("uses document selection as document-only scope", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      selectedChannels: [
        { chatId: "group-a", chatType: "group" as const, name: "A" },
      ],
      participants: [{ userId: "user-a", userName: "Alex" }],
      timeRange: {
        start: "2026-09-01T00:00:00Z",
        end: "2026-09-02T00:00:00Z",
        label: "昨天",
      },
    };
    const documents = documentsToScope([
      { docId: "doc-a", title: "Doc A", docType: "doc", updatedAt: null },
    ]);
    const result = replaceSelectedDocuments(scope, documents);

    expect(result.participantsCleared).toBe(true);
    expect(result.scope).toMatchObject({
      selectedChannels: [],
      documents,
      participants: [],
      timeRange: null,
    });
    expect(canSelectParticipants(result.scope)).toBe(false);
  });

  it("removes a reference without changing other scope fields", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      referencedTaskIds: [10, 20],
    };
    const result = removeScopeContext(scope, "reference", "10");
    expect(result.scope.referencedTaskIds).toEqual([20]);
  });

  it("treats a missing optional documents field as an empty selection", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      documents: undefined,
    };
    const result = removeScopeContext(scope, "document", "doc-a");
    expect(result.scope.documents).toEqual([]);
  });
});
