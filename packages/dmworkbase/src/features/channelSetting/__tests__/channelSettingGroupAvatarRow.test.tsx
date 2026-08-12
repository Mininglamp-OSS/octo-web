// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/dom";
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupAvatarSettingRow } from "../channelSettingGroupProfileRows";

const mocks = vi.hoisted(() => ({
  fetchCurrentImChannelInfo: vi.fn(),
  channelAvatarProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Tag: () => null,
  Toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  fetchCurrentImChannelInfo: mocks.fetchCurrentImChannelInfo,
}));

vi.mock("../../../Components/ChannelAvatar", async () => {
  const ReactModule = await import("react");
  return {
    ChannelAvatar: (props: Record<string, unknown>) => {
      mocks.channelAvatarProps = props;
      return props.visible
        ? ReactModule.createElement("div", { "data-testid": "avatar-editor" })
        : null;
    },
  };
});

vi.mock("../../../Components/ChannelQRCode", () => ({
  default: () => null,
}));

vi.mock("../../../ui/ChannelSettingRows", async () => {
  const ReactModule = await import("react");
  return {
    ChannelSettingIconRow: ({
      title,
      onClick,
    }: {
      title: string;
      onClick?: () => void;
    }) => ReactModule.createElement("button", { onClick }, title),
    ChannelSettingInlineEditRow: () => null,
  };
});

vi.mock("../../../App", () => ({
  default: {
    shared: {
      avatarChannel: vi.fn(() => "avatar-url"),
    },
  },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

describe("GroupAvatarSettingRow", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.fetchCurrentImChannelInfo.mockReset();
    mocks.channelAvatarProps = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it("refreshes avatar source fields before opening the editor", async () => {
    const channel = new Channel("group-1", ChannelTypeGroup);
    mocks.fetchCurrentImChannelInfo.mockResolvedValue({
      title: "Latest Group",
      orgData: {
        avatar_text: "最新",
        avatar_color: "7",
        is_named: 1,
        is_upload_avatar: 1,
      },
    });

    act(() => {
      ReactDOM.render(
        <GroupAvatarSettingRow
          title="Group avatar"
          icon={<span />}
          channel={channel}
          showUpload
          groupName="Cached Group"
          isNamedGroup={false}
          initialAvatarText="旧值"
          initialColorIndex={2}
          isUploadedAvatar={false}
          canClearUploadedAvatar
        />,
        container
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Group avatar" }));
      await Promise.resolve();
    });

    expect(mocks.fetchCurrentImChannelInfo).toHaveBeenCalledWith(channel);
    expect(screen.getByTestId("avatar-editor")).toBeTruthy();
    expect(mocks.channelAvatarProps).toMatchObject({
      groupName: "Latest Group",
      isNamedGroup: true,
      initialAvatarText: "最新",
      initialColorIndex: 7,
      isUploadedAvatar: true,
      visible: true,
    });
  });
});
