import { describe, expect, it, vi } from "vitest";

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  },
}));

import { Channel } from "wukongimjssdk";
import {
  canLocateChannelSearchItem,
  resolveChannelSearchLocateTarget,
} from "../locate";
import type { ChannelSearchItem } from "../types";

function item(overrides: Partial<ChannelSearchItem> = {}): ChannelSearchItem {
  return {
    id: "m1",
    messageId: "m1",
    messageSeq: 101,
    channelId: "group-a",
    channelType: 2,
    senderUid: "u1",
    timestamp: 1,
    kind: "text",
    ...overrides,
  };
}

describe("channel search locate target", () => {
  it("keeps current-channel hits on the current conversation", () => {
    const target = resolveChannelSearchLocateTarget(
      item(),
      new Channel("group-a", 2)
    );

    expect(target).toMatchObject({
      isCurrentChannel: true,
      messageSeq: 101,
      channel: {
        channelID: "group-a",
        channelType: 2,
      },
    });
  });

  it("preserves cross-channel hit origin for showConversation locate", () => {
    const target = resolveChannelSearchLocateTarget(
      item({ channelId: "thread-a", channelType: 5, messageSeq: 202 }),
      new Channel("group-a", 2)
    );

    expect(target).toMatchObject({
      isCurrentChannel: false,
      messageSeq: 202,
      channel: {
        channelID: "thread-a",
        channelType: 5,
      },
    });
  });

  it("disables locate when the backend omits a usable message sequence", () => {
    expect(canLocateChannelSearchItem(item({ messageSeq: 0 }))).toBe(false);
    expect(
      resolveChannelSearchLocateTarget(
        item({ messageSeq: 0 }),
        new Channel("group-a", 2)
      )
    ).toBeUndefined();
  });
});
