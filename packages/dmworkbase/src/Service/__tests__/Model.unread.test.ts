import { beforeEach, describe, expect, it, vi } from "vitest";
import { Channel, ChannelTypePerson, ChannelTypeGroup, Conversation, Message } from "wukongimjssdk";

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
import { MessageContentTypeConst } from "../Const";

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

// Helper: build a group conversation whose lastMessage carries the given
// contentType. Used to verify passive tips do not light unread badges.
// Message.contentType is a getter on the SDK class, so we build a minimal
// duck-typed value with just the field ConversationWrap.isSystemMessage
// reads. That keeps the test scoped to Model.tsx behavior without depending
// on how the SDK internally maps content objects to contentType numbers.
function groupConversationWithLastMessageType(rawUnread: number, contentType: number) {
  const conversation = new Conversation();
  conversation.channel = new Channel("group-1", ChannelTypeGroup);
  conversation.unread = rawUnread;
  conversation.extra = {};
  conversation.lastMessage = { contentType } as unknown as Message;
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

// #1283 round-7 P1 (Jerry-Xin / lml2468 / yujiawei): passive-tip content
// types 21 (summaryNotify) and 20 (screenshot) sit OUTSIDE the SDK's
// isSystemMessage() 1000-2000 range. Without an explicit entry in
// systemContentTypes the existing "raw unread = 1 && last message is system"
// suppression at Model.tsx never fires for them, so the sidebar lights an
// unread badge on a message that is by design a silent grey tip.
describe("ConversationWrap unread — passive-tip content types (types 20, 21)", () => {
  beforeEach(() => {
    state.currentSpaceId = "";
  });

  it("does not increment unread when the sole unread message is a summaryNotify (21)", () => {
    expect(
      groupConversationWithLastMessageType(1, MessageContentTypeConst.summaryNotify).unread,
    ).toBe(0);
  });

  it("does not increment unread when the sole unread message is a screenshot (20)", () => {
    expect(
      groupConversationWithLastMessageType(1, MessageContentTypeConst.screenshot).unread,
    ).toBe(0);
  });

  // Mixed unread — the "raw=1 && system" suppression deliberately fires only
  // when rawUnread === 1 so a passive tip does NOT hide a real backlog of
  // unread user messages. If the last message happens to be a passive tip but
  // rawUnread > 1, the badge should still show the raw count.
  it("still reports rawUnread when raw > 1 (mixed unread with tip last)", () => {
    expect(
      groupConversationWithLastMessageType(5, MessageContentTypeConst.summaryNotify).unread,
    ).toBe(5);
  });
});
