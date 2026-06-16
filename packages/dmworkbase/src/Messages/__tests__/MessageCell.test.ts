import { beforeEach, describe, expect, it, vi } from "vitest";

const channelManager = vi.hoisted(() => ({
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addSubscriberChangeListener: vi.fn(),
  removeSubscriberChangeListener: vi.fn(),
  getChannelInfo: vi.fn(),
  fetchChannelInfo: vi.fn(),
}));

vi.mock("wukongimjssdk", () => {
  const ChannelTypePerson = 1;
  const ChannelTypeGroup = 2;
  class Channel {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }

    isEqual(other?: Channel) {
      return (
        !!other &&
        this.channelID === other.channelID &&
        this.channelType === other.channelType
      );
    }
  }
  const sdk = { shared: () => ({ channelManager }) };
  return {
    default: sdk,
    WKSDK: sdk,
    Channel,
    ChannelTypePerson,
    ChannelTypeGroup,
  };
});

import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { MessageCell } from "../MessageCell";

function createCell(channelID = "group-1") {
  const message = {
    fromUID: "user-1",
    channel: new Channel(channelID, ChannelTypeGroup),
  };
  const cell = new MessageCell({ message, context: {} } as any);
  cell.setState = vi.fn() as any;
  return cell;
}

describe("MessageCell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelManager.getChannelInfo.mockReturnValue(undefined);
  });

  it("subscribes group member changes and re-renders matching group messages", () => {
    const cell = createCell();

    cell.componentDidMount();

    const listener = channelManager.addSubscriberChangeListener.mock
      .calls[0][0] as (channel: Channel) => void;
    listener(new Channel("other-group", ChannelTypeGroup));
    expect(cell.setState).not.toHaveBeenCalled();

    listener(new Channel("group-1", ChannelTypeGroup));
    expect(cell.setState).toHaveBeenCalledWith({});

    cell.componentWillUnmount();
    expect(channelManager.removeSubscriberChangeListener).toHaveBeenCalledWith(
      listener
    );
  });
});
