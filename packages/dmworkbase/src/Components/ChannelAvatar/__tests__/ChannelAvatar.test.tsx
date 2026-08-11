// @vitest-environment jsdom
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/dom";

const mocks = vi.hoisted(() => ({
  updateChannelAvatarCustom: vi.fn(() => Promise.resolve()),
  fetchCurrentImChannelInfo: vi.fn(() => Promise.resolve()),
  changeChannelAvatarTag: vi.fn(),
  uploadFile: vi.fn(() => Promise.resolve()),
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
    apiClient: {
      get: vi.fn(() => Promise.reject(new Error("offline palette"))),
    },
    shared: {
      avatarChannel: vi.fn(() => "avatar-url"),
      changeChannelAvatarTag: mocks.changeChannelAvatarTag,
    },
  },
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, loading, ...props }: any) => (
    <button type="button" disabled={loading || props.disabled} {...props}>
      {children}
    </button>
  ),
  Input: ({ value, onChange, ...props }: any) => (
    <input
      value={value}
      onChange={(event) => onChange?.((event.target as HTMLInputElement).value)}
      {...props}
    />
  ),
  Toast: {
    error: vi.fn(),
  },
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconCamera: () => <span />,
  IconTick: () => <span />,
}));

vi.mock("../../WKAvatarEditor", () => ({
  WKAvatarEditor: class {},
}));

vi.mock("../../WKModal", () => ({
  default: ({ visible, children }: any) => (visible ? <div>{children}</div> : null),
}));

import { I18nContext } from "../../../i18n";
import { ChannelAvatar, ChannelAvatarProps } from "../index";

let container: HTMLDivElement;

function renderChannelAvatar(props: Partial<ChannelAvatarProps> = {}) {
  const channel = new Channel("group-1", ChannelTypeGroup);

  act(() => {
    ReactDOM.render(
      <I18nContext.Provider value={{ t: (key: string) => key } as any}>
        <ChannelAvatar
          channel={channel}
          showUpload
          groupName="研发群"
          isNamedGroup={false}
          {...props}
        />
      </I18nContext.Provider>,
      container
    );
  });

  return channel;
}

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

beforeEach(() => {
  mocks.updateChannelAvatarCustom.mockClear();
  mocks.fetchCurrentImChannelInfo.mockClear();
  mocks.changeChannelAvatarTag.mockClear();
  mocks.uploadFile.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

describe("ChannelAvatar save intent", () => {
  it("saves one generated avatar PUT with both text and color edits", async () => {
    const channel = renderChannelAvatar();

    act(() => {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "研发" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("avatar-color-5"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("base.common.save"));
    });

    expect(mocks.updateChannelAvatarCustom).toHaveBeenCalledTimes(1);
    expect(mocks.updateChannelAvatarCustom).toHaveBeenCalledWith(channel, {
      avatarText: "研发",
      avatarColor: 5,
      clearUploadedAvatar: true,
    });
    expect(mocks.changeChannelAvatarTag).toHaveBeenCalledWith(channel);
    expect(mocks.fetchCurrentImChannelInfo).toHaveBeenCalledWith(channel);
  });

  it("saves uploaded draft through upload path instead of generated PUT", async () => {
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    const component = createComponent({ onFileUpload: mocks.uploadFile });

    component.setState({ pendingUploadFile: file, draftMode: "uploaded" } as any);
    await component.saveCustomAvatar();

    expect(mocks.uploadFile).toHaveBeenCalledWith(file);
    expect(mocks.updateChannelAvatarCustom).not.toHaveBeenCalled();
  });

  it("sends clear_uploaded_avatar when generated save has no text/color edits", async () => {
    const channel = renderChannelAvatar({ initialAvatarText: "研发", initialColorIndex: 5 });

    await act(async () => {
      fireEvent.click(screen.getByText("base.common.save"));
    });

    expect(mocks.updateChannelAvatarCustom).toHaveBeenCalledTimes(1);
    expect(mocks.updateChannelAvatarCustom).toHaveBeenCalledWith(channel, {
      avatarText: undefined,
      avatarColor: undefined,
      clearUploadedAvatar: true,
    });
  });
});
