/**
 * @vitest-environment jsdom
 */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useChannelWebhookActions,
  type ChannelWebhookActionsRuntime,
} from "../useChannelWebhookActions";
import type { IncomingWebhook } from "../../../Service/IncomingWebhook";

function createWebhook(
  overrides: Partial<IncomingWebhook> = {}
): IncomingWebhook {
  return {
    webhook_id: "iwh_1",
    group_no: "g1",
    name: "CI",
    avatar: "",
    creator_uid: "u1",
    status: 1,
    last_used_at: 0,
    call_count: 0,
    created_at: 0,
    ...overrides,
  };
}

function createRuntime(
  overrides: Partial<ChannelWebhookActionsRuntime> = {}
): ChannelWebhookActionsRuntime {
  return {
    updateStatus: vi.fn(() => Promise.resolve(createWebhook())),
    test: vi.fn(() => Promise.resolve()),
    regenerate: vi.fn(() =>
      Promise.resolve({
        ...createWebhook(),
        token: "token",
        url: "/v1/incoming-webhooks/iwh_1/token",
      })
    ),
    delete: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

let container: HTMLDivElement;
let current: ReturnType<typeof useChannelWebhookActions>;

function Probe(props: {
  runtime: ChannelWebhookActionsRuntime;
  reload: () => void | Promise<void>;
  channelId?: string;
}) {
  current = useChannelWebhookActions({
    channel: new Channel(props.channelId || "g1", ChannelTypeGroup),
    threadShortId: "t1",
    runtime: props.runtime,
    reload: props.reload,
  });
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
  vi.useRealTimers();
});

function renderProbe(params: {
  runtime: ChannelWebhookActionsRuntime;
  reload: () => void | Promise<void>;
  channelId?: string;
}) {
  act(() => {
    ReactDOM.render(
      <Probe
        runtime={params.runtime}
        reload={params.reload}
        channelId={params.channelId}
      />,
      container
    );
  });
}

describe("useChannelWebhookActions", () => {
  it("toggles webhook status through runtime and reloads", async () => {
    const runtime = createRuntime();
    const reload = vi.fn();
    renderProbe({ runtime, reload });

    await act(async () => {
      await current.toggleWebhook(createWebhook(), false);
    });

    expect(runtime.updateStatus).toHaveBeenCalledWith(
      "g1",
      "iwh_1",
      false,
      "t1"
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(current.togglingId).toBeNull();
  });

  it("tests enabled webhooks and enters cooldown", async () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const reload = vi.fn();
    renderProbe({ runtime, reload });

    await act(async () => {
      await current.testWebhook(createWebhook());
    });

    expect(runtime.test).toHaveBeenCalledWith("g1", "iwh_1", "t1");
    expect(current.coolingTestId).toBe("iwh_1");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(current.coolingTestId).toBeNull();
  });

  it("regenerates and deletes through runtime and reloads", async () => {
    const runtime = createRuntime();
    const reload = vi.fn();
    renderProbe({ runtime, reload });

    await act(async () => {
      const resp = await current.regenerateWebhook(createWebhook());
      expect(resp.ok && resp.response.token).toBe("token");
    });
    await act(async () => {
      const result = await current.deleteWebhook(createWebhook());
      expect(result.ok).toBe(true);
    });

    expect(runtime.regenerate).toHaveBeenCalledWith("g1", "iwh_1", "t1");
    expect(runtime.delete).toHaveBeenCalledWith("g1", "iwh_1", "t1");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("keeps regenerate and delete success when reload rejects", async () => {
    const runtime = createRuntime();
    const reload = vi.fn(() => Promise.reject(new Error("reload failed")));
    renderProbe({ runtime, reload });

    await act(async () => {
      const result = await current.regenerateWebhook(createWebhook());
      expect(result.ok && result.response.token).toBe("token");
    });
    await act(async () => {
      const result = await current.deleteWebhook(createWebhook());
      expect(result.ok).toBe(true);
    });

    expect(runtime.regenerate).toHaveBeenCalledWith("g1", "iwh_1", "t1");
    expect(runtime.delete).toHaveBeenCalledWith("g1", "iwh_1", "t1");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("marks regenerate and delete results stale after scope changes", async () => {
    let resolveRegenerate!: (value: any) => void;
    let resolveDelete!: () => void;
    const runtime = createRuntime({
      regenerate: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveRegenerate = resolve;
          })
      ),
      delete: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDelete = resolve;
          })
      ),
    });
    const reload = vi.fn();
    renderProbe({ runtime, reload, channelId: "g1" });

    let regeneratePromise!: ReturnType<typeof current.regenerateWebhook>;
    await act(async () => {
      regeneratePromise = current.regenerateWebhook(createWebhook());
      await Promise.resolve();
    });
    renderProbe({ runtime, reload, channelId: "g2" });
    await act(async () => {
      resolveRegenerate({
        ...createWebhook(),
        token: "token",
        url: "/v1/incoming-webhooks/iwh_1/token",
      });
    });

    await expect(regeneratePromise).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    expect(reload).not.toHaveBeenCalled();

    renderProbe({ runtime, reload, channelId: "g1" });
    let deletePromise!: ReturnType<typeof current.deleteWebhook>;
    await act(async () => {
      deletePromise = current.deleteWebhook(createWebhook());
      await Promise.resolve();
    });
    renderProbe({ runtime, reload, channelId: "g2" });
    await act(async () => {
      resolveDelete();
    });

    await expect(deletePromise).resolves.toEqual({
      ok: false,
      reason: "stale",
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
