import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../App", () => ({
  default: {
    openSummaryShareDetail: vi.fn(),
  },
}));

import WKApp from "../../App";
import { SummaryCardContent } from "./SummaryCardContent";
import SummaryCardView from "./SummaryCardView";
import { SummaryCardCell } from ".";

describe("SummaryCardCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    WKApp.openSummaryShareDetail = vi.fn();
  });

  it("returns to the conversation context instead of the message channel", () => {
    const content = new SummaryCardContent();
    content.shareId = "share-1";
    content.spaceId = "space-1";

    const cell = new SummaryCardCell({
      message: {
        content,
        channel: { channelID: "bob", channelType: 1 },
      } as any,
      context: {
        channel: () => ({ channelID: "alice", channelType: 1 }),
      } as any,
    });
    cell.context = {
      locale: "zh-CN",
      t: (key: string) => key,
    } as any;

    const messageBase = cell.render();
    const card = React.Children.only(messageBase.props.children) as React.ReactElement<{
      onViewDetail: () => void;
    }>;

    expect(card.type).toBe(SummaryCardView);
    card.props.onViewDetail();
    expect(WKApp.openSummaryShareDetail).toHaveBeenCalledWith(
      "share-1",
      "space-1",
      { channelId: "alice", channelType: 1 },
    );
  });
});
