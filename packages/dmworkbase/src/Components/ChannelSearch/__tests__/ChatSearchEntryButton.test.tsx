// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  remoteConfig: {
    messagesSearchOn: true,
  },
  emittedEvents: [] as Array<{ event: string; payload: unknown }>,
}));

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
}));

vi.mock("../../../App", () => ({
  default: {
    remoteConfig: mockState.remoteConfig,
    mittBus: {
      emit: (event: string, payload: unknown) => {
        mockState.emittedEvents.push({ event, payload });
      },
    },
  },
}));

vi.mock("../../../Service/Const", () => ({
  ChannelTypeCommunityTopic: 5,
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import ChatSearchEntryButton from "../ChatSearchEntryButton";

let container: HTMLDivElement | null = null;

beforeEach(() => {
  mockState.emittedEvents = [];
  mockState.remoteConfig.messagesSearchOn = true;
});

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
}

describe("ChatSearchEntryButton", () => {
  it("renders when channel search is enabled for supported channel", () => {
    const channel = new Channel("group-a", ChannelTypeGroup);
    render(<ChatSearchEntryButton channel={channel as any} />);
    const button = container?.querySelector('[title="base.module.channelSettings.messageHistory"]');
    expect(button).toBeTruthy();
  });

  it("does not render when feature flag is off", () => {
    mockState.remoteConfig.messagesSearchOn = false;
    const channel = new Channel("group-a", ChannelTypeGroup);
    render(<ChatSearchEntryButton channel={channel as any} />);
    expect(container?.querySelector("div")).toBeFalsy();
  });

  it("does not render on unsupported channel type (customer service)", () => {
    const channel = new Channel("cs-a", 4);
    render(<ChatSearchEntryButton channel={channel as any} />);
    expect(container?.querySelector("div")).toBeFalsy();
  });

  it("emits wk:open-channel-search with channel identity on click", () => {
    const channel = new Channel("group-a", ChannelTypeGroup);
    render(<ChatSearchEntryButton channel={channel as any} />);
    const button = container?.querySelector(
      '[title="base.module.channelSettings.messageHistory"]'
    ) as HTMLElement;
    expect(button).toBeTruthy();
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockState.emittedEvents).toEqual([
      {
        event: "wk:open-channel-search",
        payload: { channelId: "group-a", channelType: ChannelTypeGroup },
      },
    ]);
  });
});
