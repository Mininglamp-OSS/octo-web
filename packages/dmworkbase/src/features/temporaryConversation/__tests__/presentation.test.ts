import { describe, expect, it, vi } from "vitest";

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    constructor(public channelID: string, public channelType: number) {}
    getChannelKey() { return `${this.channelType}::${this.channelID}`; }
  },
  Conversation: class {
    channel: unknown;
    timestamp = 0;
    unread = 0;
    remoteExtra: unknown;
  },
  ConversationExtra: class {
    draft = "";
  },
}));

vi.mock("../../../Service/Model", () => ({
  ConversationWrap: class {
    constructor(public conversation: { channel: unknown }) {}
    get channel() { return this.conversation.channel; }
  },
}));

import { Channel, Conversation } from "wukongimjssdk";
import { ConversationWrap } from "../../../Service/Model";
import {
  buildTemporaryConversationPresentation,
  dismissTemporaryConversation,
  leaveTemporaryConversation,
  openTemporaryConversation,
  promoteTemporaryConversation,
  refreshTemporaryConversation,
} from "../presentation";

const channel = (id: string) => new Channel(id, 1);
const hasOnly = (...ids: string[]) => (target: Channel) => ids.includes(target.channelID);

function realConversation(id: string, unread = 0, timestamp = 0): ConversationWrap {
  const conversation = new Conversation();
  conversation.channel = channel(id);
  conversation.unread = unread;
  conversation.timestamp = timestamp;
  return new ConversationWrap(conversation);
}

describe("temporary conversation presentation lifecycle", () => {
  it("keeps an existing conversation in its temporary placement when switching chats", () => {
    const initial = openTemporaryConversation({}, channel("old"), hasOnly("old"));
    const next = leaveTemporaryConversation(initial, channel("other"), hasOnly("old", "other"));

    expect(next).toBe(initial);
  });

  it("returns an existing conversation to its normal position on list refresh", () => {
    const state = openTemporaryConversation({}, channel("old"), hasOnly("old"));

    expect(refreshTemporaryConversation(state)).toEqual({});
  });

  it("keeps a virtual temporary item through a list refresh", () => {
    const state = openTemporaryConversation({}, channel("new"), hasOnly());

    expect(refreshTemporaryConversation(state)).toBe(state);
  });

  it("keeps one virtual item after leaving it and replaces it on the next virtual external open", () => {
    const first = openTemporaryConversation({}, channel("first"), hasOnly());
    const left = leaveTemporaryConversation(first, channel("other"), hasOnly());
    const second = openTemporaryConversation(left, channel("second"), hasOnly());

    expect(left.active?.channel.channelID).toBe("first");
    expect(second.active?.channel.channelID).toBe("second");
    expect(buildTemporaryConversationPresentation(second, () => undefined).conversations)
      .toHaveLength(1);
  });

  it("replaces a virtual row with its real conversation without a duplicate", () => {
    const state = openTemporaryConversation({}, channel("new"), hasOnly());
    const real = realConversation("new");
    const presentation = buildTemporaryConversationPresentation(
      state,
      (target) => target.channelID === "new" ? real : undefined,
    );

    expect(presentation.conversations).toEqual([real]);
    expect(presentation.virtualChannelKeys.size).toBe(0);
  });

  it.each([false, true])("releases temporary presentation after sending with existing=%s", (existing) => {
    const state = openTemporaryConversation({}, channel("new"), () => existing);
    expect(promoteTemporaryConversation(state, channel("new"))).toEqual({});
  });

  it.each([false, true])("replaces a virtual row with an existing external open after leaving=%s", (leaveFirst) => {
    const first = openTemporaryConversation({}, channel("first"), hasOnly("old"));
    const previous = leaveFirst
      ? leaveTemporaryConversation(first, channel("other"), hasOnly("old"))
      : first;
    const next = openTemporaryConversation(previous, channel("old"), hasOnly("old"));
    const real = realConversation("old");

    expect(buildTemporaryConversationPresentation(next, () => real).conversations).toEqual([real]);
    expect(next.active?.origin).toBe("existing");
  });

  it("replaces existing temporary conversations without changing their data", () => {
    const first = openTemporaryConversation({}, channel("first"), hasOnly("first", "second"));
    const next = openTemporaryConversation(first, channel("second"), hasOnly("first", "second"));
    const real = realConversation("second", 7, 123);

    expect(buildTemporaryConversationPresentation(next, () => real).conversations).toEqual([real]);
    expect(real.conversation.unread).toBe(7);
    expect(real.conversation.timestamp).toBe(123);
  });

  it("keeps the temporary item on a same-channel sidebar click", () => {
    const state = openTemporaryConversation({}, channel("old"), hasOnly("old"));
    expect(leaveTemporaryConversation(state, channel("old"), hasOnly("old"))).toBe(state);
  });

  it("dismisses the target without clearing a more recently opened conversation", () => {
    const state = openTemporaryConversation({}, channel("new"), hasOnly());
    expect(dismissTemporaryConversation(state, channel("new"))).toEqual({});
    expect(dismissTemporaryConversation(state, channel("old"))).toBe(state);
    expect(promoteTemporaryConversation(state, channel("old"))).toBe(state);
    expect(dismissTemporaryConversation(state, new Channel("new", 2))).toBe(state);
  });
});
