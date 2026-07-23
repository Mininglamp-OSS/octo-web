import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../App", () => ({
  default: {
    loginInfo: {},
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelSubscribers: vi.fn(() => []),
  syncCurrentImChannelSubscribers: vi.fn(() => Promise.resolve()),
}));

import {
  buildChannelWebhookMemberOptionsForSelect,
  readChannelWebhookMemberOptions,
} from "../useChannelWebhookMembers";
import type { ChannelWebhookMemberRuntime } from "../types";

function createRuntime(
  overrides: Partial<ChannelWebhookMemberRuntime> = {}
): ChannelWebhookMemberRuntime {
  return {
    getSubscribers: vi.fn(() => []),
    syncSubscribers: vi.fn(() => Promise.resolve()),
    isBotMember: vi.fn(() => false),
    getSelfUid: vi.fn(() => ""),
    getSelfDisplayName: vi.fn(() => ""),
    ...overrides,
  };
}

describe("channel webhook members bridge", () => {
  it("maps subscribers into deduped mention options", () => {
    const runtime = createRuntime({
      getSubscribers: vi.fn(() => [
        { uid: "u1", name: "Alice" },
        { uid: "u1", name: "Duplicated" },
        { uid: "bot1", name: "HelperBot", orgData: { robot: 1 } },
        { uid: "" },
      ]),
      isBotMember: vi.fn((uid) => uid === "bot1"),
    });

    const options = readChannelWebhookMemberOptions({
      channel: new Channel("g1", ChannelTypeGroup),
      runtime,
    });

    expect(options).toEqual([
      { uid: "u1", name: "Alice", isBot: false },
      { uid: "bot1", name: "HelperBot", isBot: true },
    ]);
  });

  it("adds self and configured fallback uids without duplicating known members", () => {
    const runtime = createRuntime({
      getSelfUid: vi.fn(() => "me"),
      getSelfDisplayName: vi.fn(() => "Me"),
    });

    const options = buildChannelWebhookMemberOptionsForSelect({
      memberOptions: [{ uid: "u1", name: "Alice", isBot: false }],
      mentionUids: ["u1", "left-user", "left-user"],
      selfFallback: "我",
      runtime,
    });

    expect(options).toEqual([
      { uid: "u1", name: "Alice", isBot: false },
      { uid: "me", name: "Me", isBot: false },
      { uid: "left-user", name: "left-user", isBot: false },
    ]);
  });
});
