import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCurrentImCommandListener,
  addCurrentImMessageListener,
  removeCurrentImCommandListener,
} from "./currentChatRuntime";

const hoisted = vi.hoisted(() => {
  const sdk = {
    chatManager: {
      addCMDListener: vi.fn(),
      removeCMDListener: vi.fn(),
      addMessageListener: vi.fn(),
    },
  };
  return {
    sdk,
    shared: vi.fn(() => sdk),
  };
});

vi.mock("wukongimjssdk", () => ({
  default: {
    shared: hoisted.shared,
  },
}));

describe("currentChatRuntime", () => {
  beforeEach(() => {
    hoisted.shared.mockClear();
    hoisted.sdk.chatManager.addCMDListener.mockReset();
    hoisted.sdk.chatManager.removeCMDListener.mockReset();
    hoisted.sdk.chatManager.addMessageListener.mockReset();
  });

  it("adds command listeners on the current SDK runtime", () => {
    const listener = vi.fn();

    addCurrentImCommandListener(listener);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.chatManager.addCMDListener).toHaveBeenCalledWith(
      listener
    );
  });

  it("adds message listeners on the current SDK runtime", () => {
    const listener = vi.fn();

    addCurrentImMessageListener(listener);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.chatManager.addMessageListener).toHaveBeenCalledWith(
      listener
    );
  });

  it("removes command listeners on the current SDK runtime", () => {
    const listener = vi.fn();

    removeCurrentImCommandListener(listener);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.chatManager.removeCMDListener).toHaveBeenCalledWith(
      listener
    );
  });
});
