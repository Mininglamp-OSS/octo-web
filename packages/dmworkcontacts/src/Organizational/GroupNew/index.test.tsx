import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wukongimjssdk", () => {
  class Channel {
    channelID: string;
    channelType: number;

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  }

  return {
    default: { shared: vi.fn() },
    Channel,
    ChannelTypeGroup: 2,
    ChannelTypePerson: 1,
    Subscriber: class Subscriber {
      uid = "";
    },
  };
});

vi.mock("@douyinfe/semi-ui", () => ({
  Button: () => null,
  Space: () => null,
  Tree: () => null,
  Input: () => null,
  CheckboxGroup: () => null,
  Checkbox: () => null,
  Toast: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@octo/base", () => ({
  WKApp: {
    loginInfo: { uid: "alice" },
    dataSource: {
      channelDataSource: {
        createChannel: vi.fn(),
        addSubscribers: vi.fn(),
      },
    },
    endpoints: {
      showConversation: vi.fn(),
    },
  },
  ThemeMode: {},
  WKViewQueueHeader: () => null,
  WKModal: () => null,
}));

vi.mock("@octo/base/src/Components/WKAvatar", () => ({
  default: () => null,
}));

vi.mock("@octo/base/src/Components/AiBadge", () => ({
  default: () => null,
}));

vi.mock("@octo/base/src/Utils/const", () => ({
  SuperGroup: 1,
}));

import { WKApp } from "@octo/base";
import { ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import {
  OrganizationalGroupNew,
  OrganizationalGroupNewAction,
} from "./index";

describe("OrganizationalGroupNew AddMember flow", () => {
  const channelDataSource = WKApp.dataSource.channelDataSource as {
    createChannel: ReturnType<typeof vi.fn>;
    addSubscribers: ReturnType<typeof vi.fn>;
  };
  const showConversation = WKApp.endpoints.showConversation as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    WKApp.loginInfo.uid = "alice";
    channelDataSource.createChannel.mockResolvedValue({ group_no: "group-1" });
    channelDataSource.addSubscribers.mockResolvedValue(undefined);
  });

  it("creates a new group before navigating when adding members from a private chat", async () => {
    const view = new OrganizationalGroupNew({
      channel: { channelID: "bob", channelType: ChannelTypePerson },
      action: OrganizationalGroupNewAction.AddMember,
    });
    view.state = {
      ...view.state,
      optPersonnelData: [{ uid: "carol" }],
    };
    view.onCancel = vi.fn();

    await view.onOK();

    expect(channelDataSource.createChannel).toHaveBeenCalledWith([
      "alice",
      "bob",
      "carol",
    ]);
    expect(channelDataSource.addSubscribers).not.toHaveBeenCalled();
    expect(showConversation).toHaveBeenCalledWith(
      expect.objectContaining({ channelID: "group-1", channelType: ChannelTypeGroup })
    );
    expect(view.onCancel).toHaveBeenCalled();
  });

  it("keeps adding subscribers directly for an existing group chat", async () => {
    const groupChannel = { channelID: "existing-group", channelType: ChannelTypeGroup };
    const view = new OrganizationalGroupNew({
      channel: groupChannel,
      action: OrganizationalGroupNewAction.AddMember,
    });
    view.state = {
      ...view.state,
      optPersonnelData: [{ uid: "carol" }],
    };
    view.onCancel = vi.fn();

    await view.onOK();

    expect(channelDataSource.addSubscribers).toHaveBeenCalledWith(groupChannel, ["carol"]);
    expect(channelDataSource.createChannel).not.toHaveBeenCalled();
    expect(showConversation).not.toHaveBeenCalled();
    expect(view.onCancel).toHaveBeenCalled();
  });
});
