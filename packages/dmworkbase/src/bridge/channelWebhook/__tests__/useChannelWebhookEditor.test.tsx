/**
 * @vitest-environment jsdom
 */
import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useChannelWebhookEditor,
  type ChannelWebhookEditorRuntime,
} from "../useChannelWebhookEditor";
import type {
  IncomingWebhook,
  IncomingWebhookCreateResp,
} from "../../../Service/IncomingWebhook";

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
  overrides: Partial<ChannelWebhookEditorRuntime> = {}
): ChannelWebhookEditorRuntime {
  return {
    create: vi.fn(() =>
      Promise.resolve({
        ...createWebhook({ webhook_id: "iwh_new" }),
        token: "token",
        url: "/v1/incoming-webhooks/iwh_new/token",
      } as IncomingWebhookCreateResp)
    ),
    update: vi.fn(() => Promise.resolve(createWebhook())),
    ...overrides,
  };
}

let container: HTMLDivElement;
let current: ReturnType<typeof useChannelWebhookEditor>;

function Probe(props: {
  runtime: ChannelWebhookEditorRuntime;
  channelId: string;
  webhook?: IncomingWebhook;
}) {
  current = useChannelWebhookEditor({
    channel: new Channel(props.channelId, ChannelTypeGroup),
    isManager: true,
    runtime: props.runtime,
    webhook: props.webhook,
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
});

function renderProbe(params: {
  runtime: ChannelWebhookEditorRuntime;
  channelId: string;
  webhook?: IncomingWebhook;
}) {
  act(() => {
    ReactDOM.render(
      <Probe
        runtime={params.runtime}
        channelId={params.channelId}
        webhook={params.webhook}
      />,
      container
    );
  });
}

describe("useChannelWebhookEditor", () => {
  it("returns stale when a create request resolves after scope changes", async () => {
    let resolveCreate!: (value: IncomingWebhookCreateResp) => void;
    const runtime = createRuntime({
      create: vi.fn(
        () =>
          new Promise<IncomingWebhookCreateResp>((resolve) => {
            resolveCreate = resolve;
          })
      ),
    });
    renderProbe({ runtime, channelId: "g1" });

    act(() => {
      current.setName("Deploy");
    });

    let submitPromise!: ReturnType<typeof current.submit>;
    await act(async () => {
      submitPromise = current.submit();
      await Promise.resolve();
    });

    renderProbe({ runtime, channelId: "g2" });

    await act(async () => {
      resolveCreate({
        ...createWebhook({ webhook_id: "iwh_new", group_no: "g1" }),
        token: "token",
        url: "/v1/incoming-webhooks/iwh_new/token",
      });
    });

    await expect(submitPromise).resolves.toEqual({
      ok: true,
      status: "created",
      created: {
        ...createWebhook({ webhook_id: "iwh_new", group_no: "g1" }),
        token: "token",
        url: "/v1/incoming-webhooks/iwh_new/token",
      },
      stale: true,
    });
  });

  it("returns stale when a create request rejects after scope changes", async () => {
    let rejectCreate!: (reason: unknown) => void;
    const runtime = createRuntime({
      create: vi.fn(
        () =>
          new Promise<IncomingWebhookCreateResp>((_, reject) => {
            rejectCreate = reject;
          })
      ),
    });
    renderProbe({ runtime, channelId: "g1" });

    act(() => {
      current.setName("Deploy");
    });

    let submitPromise!: ReturnType<typeof current.submit>;
    await act(async () => {
      submitPromise = current.submit();
      await Promise.resolve();
    });

    renderProbe({ runtime, channelId: "g2" });

    await act(async () => {
      rejectCreate(new Error("create failed"));
    });

    await expect(submitPromise).resolves.toEqual({
      ok: true,
      status: "stale",
    });
  });

  it("returns stale when an update request rejects after scope changes", async () => {
    let rejectUpdate!: (reason: unknown) => void;
    const runtime = createRuntime({
      update: vi.fn(
        () =>
          new Promise<IncomingWebhook>((_, reject) => {
            rejectUpdate = reject;
          })
      ),
    });
    renderProbe({
      runtime,
      channelId: "g1",
      webhook: createWebhook({ name: "Old" }),
    });

    act(() => {
      current.setName("New");
    });

    let submitPromise!: ReturnType<typeof current.submit>;
    await act(async () => {
      submitPromise = current.submit();
      await Promise.resolve();
    });

    renderProbe({
      runtime,
      channelId: "g2",
      webhook: createWebhook({ name: "Other" }),
    });

    await act(async () => {
      rejectUpdate(new Error("update failed"));
    });

    await expect(submitPromise).resolves.toEqual({
      ok: true,
      status: "stale",
    });
  });
});
