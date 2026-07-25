import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isCurrentImSystemMessage,
  registerCurrentImMessageContent,
} from "./currentMessageContentRuntime";

const hoisted = vi.hoisted(() => {
  const sdk = {
    register: vi.fn(),
    isSystemMessage: vi.fn(),
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

describe("currentMessageContentRuntime", () => {
  beforeEach(() => {
    hoisted.shared.mockClear();
    hoisted.sdk.register.mockReset();
    hoisted.sdk.isSystemMessage.mockReset();
  });

  it("registers message content on the current SDK runtime", () => {
    const factory = () => ({ type: "image" });

    registerCurrentImMessageContent(1, factory);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.register).toHaveBeenCalledWith(1, factory);
  });

  it("checks system messages on the current SDK runtime", () => {
    hoisted.sdk.isSystemMessage.mockReturnValueOnce(false);

    expect(isCurrentImSystemMessage(1)).toBe(false);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.isSystemMessage).toHaveBeenCalledWith(1);
  });
});
