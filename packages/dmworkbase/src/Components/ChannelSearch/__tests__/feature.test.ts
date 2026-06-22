import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  remoteConfig: {
    messagesSearchOn: false,
  },
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
}));

vi.mock("../../../App", () => ({
  default: {
    remoteConfig: mockState.remoteConfig,
  },
}));

vi.mock("../../../Service/Const", () => ({
  ChannelTypeCommunityTopic: 5,
}));

import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import { isChannelSearchEnabled, supportsChannelSearch } from "../feature";

describe("channel search feature gate", () => {
  it("supports group, person and community topic channels", () => {
    expect(supportsChannelSearch(new Channel("group-a", ChannelTypeGroup))).toBe(
      true
    );
    expect(supportsChannelSearch(new Channel("user-a", ChannelTypePerson))).toBe(
      true
    );
    expect(supportsChannelSearch(new Channel("thread-a", 5))).toBe(true);
    expect(supportsChannelSearch(new Channel("customer-service", 4))).toBe(
      false
    );
  });

  it("requires the backend appconfig switch to be on", () => {
    const channel = new Channel("group-a", ChannelTypeGroup);

    mockState.remoteConfig.messagesSearchOn = false;
    expect(isChannelSearchEnabled(channel)).toBe(false);

    mockState.remoteConfig.messagesSearchOn = true;
    expect(isChannelSearchEnabled(channel)).toBe(true);
  });
});
