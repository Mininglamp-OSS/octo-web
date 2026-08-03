/**
 * @vitest-environment jsdom
 */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  wkConfirm: vi.fn(),
  regenerateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  testWebhook: vi.fn(),
  reload: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  items: [
    {
      webhook_id: "iwh_1",
      group_no: "g1",
      name: "CI",
      avatar: "",
      creator_uid: "me",
      status: 1,
      last_used_at: 0,
      call_count: 0,
      created_at: 0,
    },
  ],
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Spin: () => React.createElement("span", { "data-testid": "spin" }),
  Switch: ({ checked, onChange, "aria-label": ariaLabel }: any) =>
    React.createElement("button", {
      "aria-label": ariaLabel,
      "data-checked": String(!!checked),
      onClick: () => onChange(!checked),
    }),
  Toast: { success: hoisted.toastSuccess, error: hoisted.toastError },
}));

vi.mock("@douyinfe/semi-icons", () => ({
  IconPlus: () => React.createElement("span"),
  IconLink: () => React.createElement("span"),
}));

vi.mock("../../WKModal", () => ({
  wkConfirm: hoisted.wkConfirm,
}));

vi.mock("../../WKButton", () => ({
  default: ({ children, onClick }: any) =>
    React.createElement("button", { onClick }, children),
  __esModule: true,
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    format: {
      date: () => "date",
      dateTime: () => "datetime",
    },
  }),
}));

vi.mock("../../../bridge/channelWebhook/useChannelWebhookList", () => ({
  useChannelWebhookList: () => ({
    items: hoisted.items,
    loading: false,
    error: false,
    myUid: "me",
    creatorNames: new Map([["me", "Me"]]),
    reload: hoisted.reload,
  }),
}));

vi.mock("../../../bridge/channelWebhook/useChannelWebhookActions", () => ({
  useChannelWebhookActions: () => ({
    testingId: null,
    togglingId: null,
    coolingTestId: null,
    toggleWebhook: vi.fn(),
    testWebhook: hoisted.testWebhook,
    regenerateWebhook: hoisted.regenerateWebhook,
    deleteWebhook: hoisted.deleteWebhook,
  }),
}));

vi.mock("../WebhookEditModal", () => ({
  default: () => React.createElement("div", { "data-testid": "edit-modal" }),
  __esModule: true,
}));

vi.mock("../WebhookUrlModal", () => ({
  default: ({ resp }: any) =>
    React.createElement("div", { "data-testid": "url-modal" }, resp.token),
  __esModule: true,
}));

import ChannelWebhookPanel from "../index";

let container: HTMLDivElement;

beforeEach(() => {
  hoisted.wkConfirm.mockReset();
  hoisted.regenerateWebhook.mockReset();
  hoisted.deleteWebhook.mockReset();
  hoisted.testWebhook.mockReset();
  hoisted.reload.mockReset();
  hoisted.toastSuccess.mockReset();
  hoisted.toastError.mockReset();
  hoisted.regenerateWebhook.mockResolvedValue({
    ok: true,
    response: {
      ...hoisted.items[0],
      token: "secret-token",
      url: "/v1/incoming-webhooks/iwh_1/secret-token",
    },
    stale: true,
  });
  hoisted.deleteWebhook.mockResolvedValue({ ok: true, stale: true });
  hoisted.testWebhook.mockResolvedValue(false);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

describe("ChannelWebhookPanel stale results", () => {
  const renderPanel = () => {
    act(() => {
      ReactDOM.render(
        React.createElement(ChannelWebhookPanel, {
          channel: { channelID: "g1" },
          isManager: true,
        }),
        container
      );
    });
  };

  it("does not show regenerated secret URL when result is stale", async () => {
    renderPanel();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="base.channelWebhook.action.regenerate"]'
        )!
        .click();
    });

    const confirmConfig = hoisted.wkConfirm.mock.calls[0][0];
    await act(async () => {
      await confirmConfig.onOk();
    });

    expect(hoisted.regenerateWebhook).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="url-modal"]')).toBeNull();
    expect(container.textContent).not.toContain("secret-token");
  });

  it("does not show delete success toast when result is stale", async () => {
    renderPanel();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="base.channelWebhook.action.delete"]'
        )!
        .click();
    });

    const confirmConfig = hoisted.wkConfirm.mock.calls[0][0];
    await act(async () => {
      await confirmConfig.onOk();
    });

    expect(hoisted.deleteWebhook).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccess).not.toHaveBeenCalled();
  });

  it("does not show test success toast when result is stale", async () => {
    renderPanel();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="base.channelWebhook.action.test"]'
        )!
        .click();
      await Promise.resolve();
    });

    expect(hoisted.testWebhook).toHaveBeenCalledTimes(1);
    expect(hoisted.toastSuccess).not.toHaveBeenCalled();
  });
});
