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
  default: ({ visible, children, footerConfig, onCancel }: any) =>
    visible ? (
      <div>
        {children}
        {footerConfig?.onOk && (
          <div>
            <button type="button" onClick={onCancel}>
              {footerConfig.cancelText}
            </button>
            <button type="button" onClick={footerConfig.onOk}>
              {footerConfig.okText}
            </button>
          </div>
        )}
      </div>
    ) : null,
}));

import { I18nContext } from "../../../i18n";
import { ChannelAvatar, ChannelAvatarProps } from "../index";
import { colorIndexForSeed } from "../../GroupAvatarPreview/text";

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
  it("updates the left preview when generated avatar text changes", () => {
    renderChannelAvatar();

    expect(container.querySelector(".wk-group-avatar-preview-text")).toBeNull();

    act(() => {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "研发" },
      });
    });

    expect(container.querySelector(".wk-group-avatar-preview-text")?.textContent).toBe("研发");
  });

  it("keeps long input editable while previewing and saving only the first four characters", async () => {
    const channel = renderChannelAvatar();
    const input = screen.getByRole("textbox") as HTMLInputElement;

    act(() => {
      fireEvent.change(input, {
        target: { value: "研发项目组" },
      });
    });

    expect(input.value).toBe("研发项目组");
    expect(container.querySelector(".wk-group-avatar-preview-text")?.textContent).toBe("研发项目");
    expect(container.querySelector(".wk-group-avatar-edit-input-meta.is-exceeded")).toBeTruthy();
    expect(screen.getByText("5/4")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("base.common.save"));
    });

    expect(mocks.updateChannelAvatarCustom).toHaveBeenCalledWith(channel, {
      avatarText: "研发项目",
      avatarColor: undefined,
      clearUploadedAvatar: false,
    });
  });

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
      clearUploadedAvatar: false,
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

    component.resetDraftFromProps();
    expect(component.state.draftMode).toBe("generated");
  });

  it("closes without PUT when generated save has no text/color edits and no uploaded avatar clear", async () => {
    const channel = renderChannelAvatar({ initialAvatarText: "研发", initialColorIndex: 5 });

    await act(async () => {
      fireEvent.click(screen.getByText("base.common.save"));
    });

    expect(mocks.updateChannelAvatarCustom).not.toHaveBeenCalled();
    expect(mocks.changeChannelAvatarTag).not.toHaveBeenCalledWith(channel);
  });

  it("does not clear an uploaded avatar when generated fields are unchanged", async () => {
    const channel = renderChannelAvatar({
      initialAvatarText: "研发",
      initialColorIndex: 5,
      isUploadedAvatar: true,
      canClearUploadedAvatar: true,
    });

    await act(async () => {
      fireEvent.click(screen.getByText("base.common.save"));
    });

    expect(mocks.updateChannelAvatarCustom).not.toHaveBeenCalled();
    expect(mocks.changeChannelAvatarTag).not.toHaveBeenCalledWith(channel);
  });

  it("sends clear_uploaded_avatar only when creator edits an uploaded avatar", async () => {
    const channel = renderChannelAvatar({
      isUploadedAvatar: true,
      canClearUploadedAvatar: true,
    });

    expect(container.querySelector(".wk-channelavatar-avatar-img")).toBeTruthy();

    act(() => {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "研发" },
      });
    });
    act(() => {
      fireEvent.click(screen.getByText("base.channelAvatar.useGeneratedAvatar"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("base.common.save"));
    });

    expect(mocks.updateChannelAvatarCustom).toHaveBeenCalledWith(channel, {
      avatarText: "研发",
      avatarColor: undefined,
      clearUploadedAvatar: true,
    });
    expect(container.querySelector(".wk-group-avatar-preview-text")?.textContent).toBe("研发");
  });

  it("does not clear an uploaded avatar after a net-zero text edit", async () => {
    const channel = renderChannelAvatar({
      initialAvatarText: "研发",
      isUploadedAvatar: true,
      canClearUploadedAvatar: true,
    });

    act(() => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "研发X" } });
    });
    act(() => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "研发" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("base.common.save"));
    });

    expect(mocks.updateChannelAvatarCustom).not.toHaveBeenCalled();
    expect(mocks.changeChannelAvatarTag).not.toHaveBeenCalledWith(channel);
  });

  it("preserves a cropped upload when generated editing returns to its initial values", () => {
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    const component = createComponent({ isUploadedAvatar: true });
    component.setState({
      draftMode: "uploaded",
      pendingUploadFile: file,
      uploadPreviewUrl: "blob:preview",
    } as any);
    component.onGeneratedAvatarChange({
      avatarText: "",
      colorIndex: undefined,
      textChanged: false,
      colorChanged: false,
    });

    expect(component.state.draftMode).toBe("uploaded");
    expect(component.state.pendingUploadFile).toBe(file);
    expect(component.state.uploadPreviewUrl).toBe("blob:preview");
  });

  it("updates the large preview immediately when generated text changes", async () => {
    renderChannelAvatar({ initialAvatarText: "原头像" });

    act(() => {
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "研发" },
      });
    });

    expect(document.querySelector(".wk-channelavatar-generated-preview")).toBeTruthy();
    expect(screen.getAllByText("研发")).toHaveLength(2);
  });

  it("uses the group number seed for the default generated preview color", async () => {
    renderChannelAvatar({ initialColorIndex: undefined });

    act(() => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "研发" } });
    });

    const preview = document.querySelector(".wk-channelavatar-generated-preview") as HTMLElement;
    expect(preview.style.background).toBe("rgb(253, 249, 237)");
    expect(colorIndexForSeed("group-1", 10)).toBe(4);
  });

  it("renders as modal and calls onClose instead of route pop", async () => {
    const onClose = vi.fn();

    renderChannelAvatar({ visible: true, onClose });

    await act(async () => {
      fireEvent.click(screen.getByText("base.common.cancel"));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
