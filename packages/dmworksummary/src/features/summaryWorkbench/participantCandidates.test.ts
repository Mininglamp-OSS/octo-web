import { afterEach, describe, expect, it, vi } from "vitest";
import { WKSDK } from "wukongimjssdk";
import { summarySubscribers } from "../../__tests__/fixtures/summarySubscribers";
import { legacySummaryMessagingPort } from "../../host/legacySummaryMessaging";
import type { SummaryMessagingPort } from "../../host";
import type { SummaryWorkbenchChannelScope } from "../../bridge/summaryWorkbench/protocol";
import { loadParticipantCandidates } from "./participantCandidates";

const groups: SummaryWorkbenchChannelScope[] = [
  { chatId: "group-a", chatType: "group", name: "A" },
  { chatId: "group-b", chatType: "group", name: "B" },
];

afterEach(() => vi.restoreAllMocks());

describe("participant candidate loading", () => {
  it.each(["web", "host"] as const)("filters real SDK member DTOs on the %s path", async (mode) => {
    const manager = WKSDK.shared().channelManager;
    vi.spyOn(manager, "syncSubscribes").mockResolvedValue(undefined);
    vi.spyOn(manager, "getSubscribes").mockReturnValue(summarySubscribers());
    const result = await loadParticipantCandidates(groups, {
      currentUserId: "self",
      spaceId: "space-a",
      messaging: mode === "host" ? legacySummaryMessagingPort : undefined,
    });
    expect(result.members).toEqual([
      { uid: "human", name: "Remark" },
      { uid: "verified", name: "Verified name" },
    ]);
    expect(result.roles.get("human")).toBe(2);
  });

  it("uses the supplied host without reading the local IM member loader", async () => {
    const loadGroupMembers = vi.fn(async () => { throw new Error("unexpected local IM read"); });
    const loadConversationMembers = vi.fn(async () => [
      { uid: "self", name: "Me" },
      { uid: "human", name: "Human", role: 2 },
      { uid: "bot", name: "Bot", isBot: true },
    ]);
    const messaging: SummaryMessagingPort = {
      getCurrentUser: () => ({ uid: "self", displayName: "Me" }),
      loadConversationMembers,
      openConversation: vi.fn(async () => {}),
      notifySummaryCompleted: vi.fn(async () => {}),
      requestForward: vi.fn(),
      subscribeInvalidation: () => () => {},
    };
    const result = await loadParticipantCandidates(groups, {
      currentUserId: "self", spaceId: "space-a", messaging,
      loader: { loadGroupMembers, loadSpaceMembers: async () => [] },
    });
    expect(loadGroupMembers).not.toHaveBeenCalled();
    expect(loadConversationMembers.mock.calls).toEqual([
      [{ channelId: "group-a", channelType: 2 }],
      [{ channelId: "group-b", channelType: 2 }],
    ]);
    expect(result.members).toEqual([{ uid: "human", name: "Human" }]);
    expect(result.roles.get("human")).toBe(2);
  });

  it("merges selected group members by uid and keeps the strongest role", async () => {
    const result = await loadParticipantCandidates(groups, {
      currentUserId: "self",
      spaceId: "space-a",
      loader: {
        async loadGroupMembers(channel) {
          return channel.chatId === "group-a"
            ? [
                { uid: "self", name: "Me", status: 1 },
                { uid: "shared", name: "Shared", role: 0, status: 1 },
                { uid: "only-a", name: "Only A", status: 1 },
                { uid: "deleted", name: "Deleted", status: 1, is_deleted: 1 },
              ]
            : [
                { uid: "shared", name: "Shared", role: 2, status: 1 },
                { uid: "only-b", name: "Only B", status: 1 },
                { uid: "inactive", name: "Inactive", status: 0 },
                { uid: "bot", name: "Bot", status: 1, is_bot: true },
              ];
        },
        async loadSpaceMembers() {
          return [];
        },
      },
    });

    expect(result.members.map((member) => member.uid)).toEqual([
      "shared",
      "only-a",
      "only-b",
    ]);
    expect(result.roles.get("shared")).toBe(2);
  });

  it("uses the Space roster when no group is selected", async () => {
    const result = await loadParticipantCandidates([], {
      currentUserId: "self",
      spaceId: "space-a",
      loader: {
        async loadGroupMembers() {
          throw new Error("unexpected group load");
        },
        async loadSpaceMembers(spaceId) {
          expect(spaceId).toBe("space-a");
          return [
            { uid: "human", name: "Human" },
            { uid: "self", name: "Me" },
            { uid: "blocked", name: "Blocked", status: 2 },
          ];
        },
      },
    });

    expect(result.members.map((member) => member.uid)).toEqual(["human"]);
  });

  it("rejects the whole union when any selected group fails to load", async () => {
    await expect(
      loadParticipantCandidates(groups, {
        currentUserId: "self",
        spaceId: "space-a",
        loader: {
          async loadGroupMembers(channel) {
            if (channel.chatId === "group-b") throw new Error("offline");
            return [{ uid: "only-a", name: "Only A", status: 1 }];
          },
          async loadSpaceMembers() {
            return [];
          },
        },
      })
    ).rejects.toThrow("offline");
  });

  it("limits concurrent group-member requests to four", async () => {
    let active = 0;
    let peak = 0;
    await loadParticipantCandidates(
      Array.from({ length: 12 }, (_, index) => ({
        chatId: `group-${index}`,
        chatType: "group" as const,
        name: `Group ${index}`,
      })),
      {
        currentUserId: "self",
        spaceId: "space-a",
        loader: {
          async loadGroupMembers() {
            active += 1;
            peak = Math.max(peak, active);
            await Promise.resolve();
            active -= 1;
            return [];
          },
          async loadSpaceMembers() {
            return [];
          },
        },
      }
    );
    expect(peak).toBe(4);
  });
});
