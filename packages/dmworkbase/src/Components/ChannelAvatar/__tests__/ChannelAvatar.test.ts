import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateChannelAvatarCustom: vi.fn(() => Promise.resolve()),
  fetchCurrentImChannelInfo: vi.fn(() => Promise.resolve()),
  changeChannelAvatarTag: vi.fn(),
}));

vi.mock("../../../Service/ChannelSettingService", () => ({
  updateChannelAvatarCustom: mocks.updateChannelAvatarCustom,
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  fetchCurrentImChannelInfo: mocks.fetchCurrentImChannelInfo,
}));

vi.mock("../../../App", () => ({
  default: {
    loginInfo: { token: "token" },
    shared: {
      avatarChannel: vi.fn(() => "avatar-url"),
      changeChannelAvatarTag: mocks.changeChannelAvatarTag,
    },
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Button: () => null,
  Toast: {
    error: vi.fn(),
  },
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconCamera: () => null,
}));

vi.mock("../../WKAvatarEditor", () => ({
  WKAvatarEditor: class {},
}));

vi.mock("../../GroupAvatarEditModal", () => ({
  GroupAvatarEditForm: () => null,
}));

vi.mock("../../WKModal", () => ({
  default: () => null,
}));

import { ChannelAvatar, ChannelAvatarProps } from "../index";

beforeEach(() => {
  mocks.updateChannelAvatarCustom.mockClear();
  mocks.fetchCurrentImChannelInfo.mockClear();
  mocks.changeChannelAvatarTag.mockClear();
});

function createComponent(props: Partial<ChannelAvatarProps> = {}) {
  const component = new (ChannelAvatar as any)({
    channel: new Channel("group-1", ChannelTypeGroup),
    showUpload: true,
    ...props,
  } as ChannelAvatarProps) as any;

  component.context = { t: (key: string) => key };
  component.setState = ((update: any) => {
    const next = typeof update === "function" ? update(component.state, component.props) : update;
    component.state = { ...component.state, ...next };
  }) as any;

  return component;
}

describe("ChannelAvatar save intent", () => {
  it("saves generated avatar with clear_uploaded_avatar when text/color changed", async () => {
    const component = createComponent();

    component.onGeneratedAvatarChange({
      avatarText: "研发",
      textChanged: true,
      colorIndex: 5,
      colorChanged: true,
    });
    await component.saveCustomAvatar();

    expect(mocks.updateChannelAvatarCustom).toHaveBeenCalledWith(
      component.props.channel,
      {
        avatarText: "研发",
        avatarColor: 5,
        clearUploadedAvatar: true,
      }
    );
    expect(mocks.changeChannelAvatarTag).toHaveBeenCalledWith(component.props.channel);
    expect(mocks.fetchCurrentImChannelInfo).toHaveBeenCalledWith(component.props.channel);
  });

  it("saves uploaded draft through upload path instead of generated PUT", async () => {
    const onFileUpload = vi.fn(() => Promise.resolve());
    const component = createComponent({ onFileUpload });
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    component.setState({ pendingUploadFile: file, draftMode: "uploaded" } as any);
    await component.saveCustomAvatar();

    expect(onFileUpload).toHaveBeenCalledWith(file);
    expect(mocks.updateChannelAvatarCustom).not.toHaveBeenCalled();
  });
});
