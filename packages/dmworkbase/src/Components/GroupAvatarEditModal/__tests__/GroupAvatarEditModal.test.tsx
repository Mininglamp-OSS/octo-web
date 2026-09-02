// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/dom";
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@douyinfe/semi-ui", () => ({
  Input: ({ value, onChange, ...props }: any) => (
    <input
      value={value}
      onChange={(event) => onChange?.((event.target as HTMLInputElement).value)}
      {...props}
    />
  ),
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconEyeClosed: () => <span />,
  IconEyeOpened: () => <span />,
  IconSearchStroked: () => <span />,
  IconTick: () => <span />,
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("@octo/ui", () => ({
  Input: ({ value, onChange, ...props }: any) => (
    <input
      value={value}
      onChange={(event) => onChange?.((event.target as HTMLInputElement).value)}
      {...props}
    />
  ),
  Modal: ({ visible, children, footerConfig, onCancel }: any) => (
    <div data-visible={String(visible)}>
      {children}
      {visible && (
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
  ),
}));

vi.mock("../../GroupAvatarPreview", () => ({
  default: () => <div />,
}));

vi.mock("../../GroupAvatarPreview/palette", () => ({
  getCachedPalette: () => [],
  fetchGroupAvatarPalette: () => Promise.resolve([]),
}));

import { GroupAvatarEditModal } from "../index";

describe("GroupAvatarEditModal", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
  });

  it("discards cancelled avatar edits before reopening", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const render = (visible: boolean) => {
      act(() => {
        ReactDOM.render(
          <GroupAvatarEditModal
            visible={visible}
            initialAvatarText=""
            onSave={onSave}
            onCancel={onCancel}
          />,
          container
        );
      });
    };

    render(true);
    act(() => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "AB" } });
      fireEvent.click(screen.getByText("base.common.cancel"));
    });

    render(false);
    render(true);

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");

    act(() => {
      fireEvent.click(screen.getByText("base.common.ok"));
    });
    expect(onSave).toHaveBeenCalledWith({ avatarText: "", colorIndex: undefined });
  });
});
