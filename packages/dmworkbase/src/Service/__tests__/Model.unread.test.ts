import { beforeEach, describe, expect, it, vi } from "vitest";
import { Channel, ChannelTypePerson, Conversation } from "wukongimjssdk";

const state = vi.hoisted(() => ({ currentSpaceId: "" }));

vi.mock("../../App", () => ({
  default: {
    shared: {
      get currentSpaceId() {
        return state.currentSpaceId;
      },
    },
  },
}));

import { ConversationWrap } from "../Model";

function personConversation(rawUnread: number, spaceUnread?: number) {
  const conversation = new Conversation();
  conversation.channel = new Channel("person-1", ChannelTypePerson);
  conversation.unread = rawUnread;
  conversation.extra = {};
  if (spaceUnread !== undefined) {
    conversation.extra.spaceUnread = spaceUnread;
  }
  return new ConversationWrap(conversation);
}

describe("ConversationWrap unread by Space", () => {
  beforeEach(() => {
    state.currentSpaceId = "";
  });

  it("uses the current Space value even when the global unread value is zero", () => {
    state.currentSpaceId = "space-1";
    expect(personConversation(0, 3).unread).toBe(3);
  });

  it("uses a zero current Space value instead of a positive global value", () => {
    state.currentSpaceId = "space-1";
    expect(personConversation(7, 0).unread).toBe(0);
  });

  it("falls back to the global unread value outside Space mode", () => {
    expect(personConversation(7, 3).unread).toBe(7);
  });
});
