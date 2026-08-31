import { describe, expect, it } from "vitest";
import { ChannelTypeGroup } from "wukongimjssdk";
import {
  canSelectParticipants,
  canGenerateFromScope,
  chatCandidatesToScope,
  emptySummaryWorkbenchScope,
  participantSourceChannel,
  removeScopeContext,
  replaceSelectedChannels,
} from "./scope";

describe("summary workbench scope helpers", () => {
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

  it("clears participants when their source chat changes", () => {
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
    expect(result.participantsCleared).toBe(true);
    expect(result.scope.participants).toEqual([]);
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

  it("allows participant selection globally or from exactly one group chat", () => {
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
        selectedChannels: [
          { chatId: "group-a", chatType: "group", name: "A" },
          { chatId: "group-b", chatType: "group", name: "B" },
        ],
      })
    ).toBe(false);
  });

  it("does not silently choose the first chat as the participant source", () => {
    const emptyScope = emptySummaryWorkbenchScope();
    const source = participantSourceChannel({
      ...emptyScope,
      selectedChannels: [{ chatId: "group-a", chatType: "group", name: "A" }],
    });
    expect(source?.channelID).toBe("group-a");
    expect(source?.channelType).toBe(ChannelTypeGroup);

    expect(
      participantSourceChannel({
        ...emptyScope,
        selectedChannels: [
          { chatId: "group-a", chatType: "group", name: "A" },
          { chatId: "group-b", chatType: "group", name: "B" },
        ],
      })
    ).toBeNull();
  });

  it("clears participants when a second chat makes their source ambiguous", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      selectedChannels: [
        { chatId: "group-a", chatType: "group" as const, name: "A" },
      ],
      participants: [{ userId: "user-a", userName: "Alex" }],
    };

    const result = replaceSelectedChannels(scope, [
      { chatId: "group-a", chatType: "group", name: "A" },
      { chatId: "group-b", chatType: "group", name: "B" },
    ]);
    expect(result.participantsCleared).toBe(true);
    expect(result.scope.participants).toEqual([]);
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
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "A" },
        ],
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
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "A" },
        ],
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
        selectedChannels: [
          { chatId: "chat-a", chatType: "group", name: "A" },
        ],
        participants: [{ userId: "user-a", userName: "Alex" }],
        template: {
          templateId: "weekly",
          label: "Weekly",
          requirement: "Summarize progress",
        },
      })
    ).toBe(true);
  });

  it("removes a reference without changing other scope fields", () => {
    const scope = {
      ...emptySummaryWorkbenchScope(),
      referencedTaskIds: [10, 20],
    };
    const result = removeScopeContext(scope, "reference", "10");
    expect(result.scope.referencedTaskIds).toEqual([20]);
  });
});
