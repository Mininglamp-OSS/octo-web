import { beforeEach, describe, expect, it, vi } from "vitest";

const channelManager = vi.hoisted(() => ({
  syncSubscribes: vi.fn(() => Promise.resolve()),
}));

vi.mock("wukongimjssdk", () => {
  const ChannelTypeGroup = 2;
  class Channel {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
    getChannelKey() {
      return `${this.channelID}-${this.channelType}`;
    }
  }
  const sdk = { shared: () => ({ channelManager }) };
  return { default: sdk, WKSDK: sdk, Channel, ChannelTypeGroup };
});

import { syncSubscribersAfterMembershipChange } from "../subscriberSync";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";

describe("subscriberSync", () => {
  beforeEach(() => {
    channelManager.syncSubscribes.mockClear();
  });

  it("issue 514: syncs subscribers after a local membership change so the mention list refreshes without a page reload", async () => {
    const channel = new Channel("group1", ChannelTypeGroup);

    await syncSubscribersAfterMembershipChange(channel);

    // addSubscribers/removeSubscribers only mutate the server; the local cache
    // and subscriber-change listeners (which feed the @mention candidate list)
    // are only refreshed by channelManager.syncSubscribes.
    expect(channelManager.syncSubscribes).toHaveBeenCalledTimes(1);
    expect(channelManager.syncSubscribes).toHaveBeenCalledWith(channel);
  });

  it("issue 514: swallows sync errors so the settings action still completes", async () => {
    channelManager.syncSubscribes.mockImplementationOnce(() =>
      Promise.reject(new Error("network"))
    );
    const channel = new Channel("group1", ChannelTypeGroup);

    await expect(
      syncSubscribersAfterMembershipChange(channel)
    ).resolves.toBeUndefined();
  });
});
