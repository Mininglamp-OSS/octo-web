import { describe, expect, it, vi } from "vitest";

import {
  isImSystemMessage,
  registerImMessageContent,
  type ImMessageContentRuntimeSdk,
} from "./messageContentRuntime";

function createSdk() {
  return {
    register: vi.fn(),
    isSystemMessage: vi.fn(),
  } satisfies ImMessageContentRuntimeSdk;
}

describe("messageContentRuntime", () => {
  it("registers message content through the SDK", () => {
    const sdk = createSdk();
    const factory = () => ({ type: "image" });

    registerImMessageContent(sdk, 1, factory);

    expect(sdk.register).toHaveBeenCalledWith(1, factory);
  });

  it("checks system message through the SDK", () => {
    const sdk = createSdk();
    sdk.isSystemMessage.mockReturnValueOnce(true);

    expect(isImSystemMessage(sdk, 1001)).toBe(true);
    expect(sdk.isSystemMessage).toHaveBeenCalledWith(1001);
  });
});
