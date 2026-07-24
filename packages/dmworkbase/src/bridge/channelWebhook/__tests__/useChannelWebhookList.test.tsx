/**
 * @vitest-environment jsdom
 */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../App", () => ({
  default: {
    loginInfo: {
      uid: "me",
      selfDisplayName: () => "Me",
    },
  },
}));

vi.mock("../../../Service/IncomingWebhook", () => ({
  IncomingWebhookService: {
    list: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelSubscribers: vi.fn(() => []),
}));

import { IncomingWebhookService } from "../../../Service/IncomingWebhook";
import { useChannelWebhookList } from "../useChannelWebhookList";

let container: HTMLDivElement;
let current: ReturnType<typeof useChannelWebhookList>;

function Probe(props: { onLoadError: (error: unknown) => void }) {
  current = useChannelWebhookList({
    channel: new Channel("g1", ChannelTypeGroup),
    selfFallback: "Me",
    onLoadError: props.onLoadError,
  });
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.mocked(IncomingWebhookService.list).mockResolvedValue([]);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
  vi.clearAllMocks();
});

function renderProbe(onLoadError: (error: unknown) => void) {
  act(() => {
    ReactDOM.render(
      React.createElement(Probe, { onLoadError }),
      container
    );
  });
}

describe("useChannelWebhookList", () => {
  it("does not report load errors for silent post-mutation reloads", async () => {
    const onLoadError = vi.fn();
    renderProbe(onLoadError);

    await act(async () => {
      await Promise.resolve();
    });

    vi.mocked(IncomingWebhookService.list).mockRejectedValueOnce(
      new Error("reload failed")
    );

    await act(async () => {
      await current.reload({ silentError: true });
    });

    expect(onLoadError).not.toHaveBeenCalled();
    expect(current.error).toBe(false);
  });
});
