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
    loginInfo: {},
  },
}));

vi.mock("../../../im-runtime/currentChannelRuntime", () => ({
  getCurrentImChannelInfo: vi.fn(),
  getCurrentImChannelSubscribers: vi.fn(() => []),
  syncCurrentImChannelSubscribers: vi.fn(() => Promise.resolve()),
}));

import {
  buildChannelWebhookMemberOptionsForSelect,
  readChannelWebhookMemberOptions,
  useChannelWebhookMembers,
} from "../useChannelWebhookMembers";
import type { ChannelWebhookMemberRuntime } from "../types";

function createRuntime(
  overrides: Partial<ChannelWebhookMemberRuntime> = {}
): ChannelWebhookMemberRuntime {
  return {
    getSubscribers: vi.fn(() => []),
    syncSubscribers: vi.fn(() => Promise.resolve()),
    isBotMember: vi.fn(() => false),
    getSelfUid: vi.fn(() => ""),
    getSelfDisplayName: vi.fn(() => ""),
    ...overrides,
  };
}

let container: HTMLDivElement;

function Probe(props: {
  channel: Channel;
  runtime: ChannelWebhookMemberRuntime;
}) {
  useChannelWebhookMembers({
    channel: props.channel,
    mentionUids: [],
    selfFallback: "Me",
    runtime: props.runtime,
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
  channel: Channel;
  runtime: ChannelWebhookMemberRuntime;
}) {
  act(() => {
    ReactDOM.render(
      React.createElement(Probe, {
        channel: params.channel,
        runtime: params.runtime,
      }),
      container
    );
  });
}

describe("channel webhook members bridge", () => {
  it("maps subscribers into deduped mention options", () => {
    const runtime = createRuntime({
      getSubscribers: vi.fn(() => [
        { uid: "u1", name: "Alice" },
        { uid: "u1", name: "Duplicated" },
        { uid: "bot1", name: "HelperBot", orgData: { robot: 1 } },
        { uid: "" },
      ]),
      isBotMember: vi.fn((uid) => uid === "bot1"),
    });

    const options = readChannelWebhookMemberOptions({
      channel: new Channel("g1", ChannelTypeGroup),
      runtime,
    });

    expect(options).toEqual([
      { uid: "u1", name: "Alice", isBot: false },
      { uid: "bot1", name: "HelperBot", isBot: true },
    ]);
  });

  it("adds self and configured fallback uids without duplicating known members", () => {
    const runtime = createRuntime({
      getSelfUid: vi.fn(() => "me"),
      getSelfDisplayName: vi.fn(() => "Me"),
    });

    const options = buildChannelWebhookMemberOptionsForSelect({
      memberOptions: [{ uid: "u1", name: "Alice", isBot: false }],
      mentionUids: ["u1", "left-user", "left-user"],
      selfFallback: "我",
      runtime,
    });

    expect(options).toEqual([
      { uid: "u1", name: "Alice", isBot: false },
      { uid: "me", name: "Me", isBot: false },
      { uid: "left-user", name: "left-user", isBot: false },
    ]);
  });

  it("does not resync subscribers when only the channel object identity changes", async () => {
    const runtime = createRuntime();

    renderProbe({
      channel: new Channel("g1", ChannelTypeGroup),
      runtime,
    });

    await act(async () => {
      await Promise.resolve();
    });

    renderProbe({
      channel: new Channel("g1", ChannelTypeGroup),
      runtime,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(runtime.syncSubscribers).toHaveBeenCalledTimes(1);
  });
});
