// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const state = {
    messageReaction: { read: true, write: false },
    configListener: null as (() => void) | null,
    reactionListener: null as ((messageId: string) => void) | null,
  };
  return {
    state,
    addConfigChangeListener: vi.fn((listener: () => void) => {
      state.configListener = listener;
      return () => {
        if (state.configListener === listener) state.configListener = null;
      };
    }),
    mittOn: vi.fn((_event: string, listener: (messageId: string) => void) => {
      state.reactionListener = listener;
    }),
    mittOff: vi.fn((_event: string, listener: (messageId: string) => void) => {
      if (state.reactionListener === listener) state.reactionListener = null;
    }),
    toggle: vi.fn().mockResolvedValue(undefined),
    selectedKeys: vi.fn().mockReturnValue([]),
    openPicker: vi.fn(),
  };
});

vi.mock("../../../App", () => ({
  default: {
    remoteConfig: {
      get messageReaction() {
        return hoisted.state.messageReaction;
      },
      addConfigChangeListener: hoisted.addConfigChangeListener,
    },
    loginInfo: { uid: "me" },
    emojiService: {
      isCustomEmoji: () => false,
      getImage: () => "",
    },
    mittBus: {
      on: hoisted.mittOn,
      off: hoisted.mittOff,
    },
  },
  __esModule: true,
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    locale: "zh-CN",
    t: (key: string) => key,
  }),
}));

vi.mock(
  "../../../ui/message/MessageReactionPicker/ReactionPickerOverlay",
  () => ({
    reactionPickerOverlay: {
      open: hoisted.openPicker,
    },
  })
);

vi.mock("../runtime", () => ({
  messageReactionController: {
    toggle: hoisted.toggle,
    selectedKeys: hoisted.selectedKeys,
  },
}));

import ReactionSlot from "../ReactionSlot";

const message = {
  messageID: "message-1",
  channel: { channelID: "group-1", channelType: 2 },
  octoReactions: [
    {
      seq: 1,
      uid: "other",
      name: "Other",
      reactionType: "emoji" as const,
      reactionKey: "👍",
      emoji: "👍",
      isDeleted: 0 as const,
    },
  ],
};

const channel = { channelID: "group-1", channelType: 2 };
let container: HTMLDivElement;

function renderSlot() {
  act(() => {
    ReactDOM.render(
      <ReactionSlot message={message} channel={channel} />,
      container
    );
  });
}

beforeEach(() => {
  hoisted.state.messageReaction = { read: true, write: false };
  hoisted.state.configListener = null;
  hoisted.state.reactionListener = null;
  hoisted.addConfigChangeListener.mockClear();
  hoisted.mittOn.mockClear();
  hoisted.mittOff.mockClear();
  hoisted.toggle.mockClear();
  hoisted.selectedKeys.mockClear();
  hoisted.openPicker.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    ReactDOM.unmountComponentAtNode(container);
  });
  container.remove();
});

describe("ReactionSlot remote capabilities", () => {
  it("renders existing reactions read-only without write controls", () => {
    renderSlot();

    const chip = container.querySelector<HTMLButtonElement>(
      ".wk-msg-reaction-chip"
    );
    expect(chip).not.toBeNull();
    expect(chip?.disabled).toBe(true);
    expect(container.querySelector(".wk-msg-reaction-add")).toBeNull();

    act(() => chip?.click());
    expect(hoisted.toggle).not.toHaveBeenCalled();
  });

  it("hides all reaction UI when read is disabled", () => {
    hoisted.state.messageReaction = { read: false, write: false };
    renderSlot();

    expect(container.querySelector(".wk-msg-reaction-summary")).toBeNull();
  });

  it("reacts to runtime capability changes", () => {
    renderSlot();
    expect(hoisted.addConfigChangeListener).toHaveBeenCalledTimes(1);

    hoisted.state.messageReaction = { read: true, write: true };
    act(() => hoisted.state.configListener?.());

    const chip = container.querySelector<HTMLButtonElement>(
      ".wk-msg-reaction-chip"
    );
    const add = container.querySelector<HTMLButtonElement>(
      ".wk-msg-reaction-add"
    );
    expect(chip?.disabled).toBe(false);
    expect(add).not.toBeNull();

    act(() => chip?.click());
    expect(hoisted.toggle).toHaveBeenCalledTimes(1);

    act(() => add?.click());
    expect(hoisted.openPicker).toHaveBeenCalledTimes(1);

    hoisted.state.messageReaction = { read: true, write: false };
    act(() => hoisted.state.configListener?.());

    expect(container.querySelector(".wk-msg-reaction-add")).toBeNull();
  });

  it("unsubscribes from remote config changes on unmount", () => {
    renderSlot();
    expect(hoisted.state.configListener).not.toBeNull();

    act(() => ReactDOM.unmountComponentAtNode(container));

    expect(hoisted.state.configListener).toBeNull();
  });
});
