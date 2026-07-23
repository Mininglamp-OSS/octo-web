import { describe, expect, it, vi } from "vitest";

import {
  addImCommandListener,
  addImMessageListener,
  type ImChatRuntimeSdk,
} from "./chatRuntime";

function createSdk() {
  return {
    chatManager: {
      addCMDListener: vi.fn(),
      addMessageListener: vi.fn(),
    },
  } satisfies ImChatRuntimeSdk;
}

describe("chatRuntime", () => {
  it("adds command listeners through the SDK chat manager", () => {
    const sdk = createSdk();
    const listener = vi.fn();

    addImCommandListener(sdk, listener);

    expect(sdk.chatManager.addCMDListener).toHaveBeenCalledWith(listener);
  });

  it("adds message listeners through the SDK chat manager", () => {
    const sdk = createSdk();
    const listener = vi.fn();

    addImMessageListener(sdk, listener);

    expect(sdk.chatManager.addMessageListener).toHaveBeenCalledWith(listener);
  });
});
