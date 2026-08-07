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

// #1283 round-8 P1-B (@yujiawei): screenshot (20) reclassification was
// deliberately withdrawn from this PR — its "counts as a system message"
// posture is a shipped product decision (removing its desktop notification
// is a privacy signal). Only summaryNotify (21) is added to systemContentTypes.
// Regression coverage stays focused on 21.
describe("ConversationWrap unread — summaryNotify passive tip (type 21)", () => {
  beforeEach(() => {
    state.currentSpaceId = "";
  });

  it("does not increment unread when the sole unread message is a summaryNotify (21)", () => {
    expect(
      groupConversationWithLastMessageType(1, MessageContentTypeConst.summaryNotify).unread,
    ).toBe(0);
  });

  // Explicit assertion that screenshot behaviour is UNCHANGED by this PR —
  // if a future PR reclassifies type 20 as a system message, this test must
  // update deliberately (and its comment should track the product owner
  // who signed off on the reclassification).
  it("preserves shipped screenshot (20) unread behaviour — NOT reclassified in this PR", () => {
    expect(
      groupConversationWithLastMessageType(1, MessageContentTypeConst.screenshot).unread,
    ).toBe(1);
  });

  // "Sole unread" scope check — reflected in the Service/Model.tsx comment:
  // the suppression only zeroes when rawUnread === 1. Multiple accumulated
  // tips or a tip on top of real unread traffic still increment the badge.
  it("still reports rawUnread when raw > 1 (mixed unread with tip last)", () => {
    expect(
      groupConversationWithLastMessageType(5, MessageContentTypeConst.summaryNotify).unread,
    ).toBe(5);
  });
});
