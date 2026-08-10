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

  // #1283 round-9 P1-B (@yujiawei): summaryNotify (21) sits outside the SDK's
  // isSystemMessage() 1000-2000 range but must classify as a system message
  // so passive-tip callsites (notification / continuity / selection /
  // context-menu / unread) treat it consistently. The classifier consolidates
  // this override in ONE place — this test pins it.
  it("classifies summaryNotify (21) as a system message without delegating to the SDK", () => {
    hoisted.sdk.isSystemMessage.mockReturnValueOnce(false);

    expect(isCurrentImSystemMessage(21)).toBe(true);

    // Short-circuit: SDK.isSystemMessage MUST NOT be consulted for 21 — the
    // override is what closes the parity gap. If a future change delegates 21
    // to the SDK the guard disappears silently.
    expect(hoisted.sdk.isSystemMessage).not.toHaveBeenCalled();
  });

  // #1283 round-9 P1-B (@yujiawei): screenshot (20) reclassification was
  // deliberately withdrawn from this PR. Its posture is a shipped product
  // decision (privacy signal on desktop notification). This test pins that
  // the classifier delegates 20 to the SDK just like every other non-21
  // contentType — a future PR that reclassifies 20 must update this test
  // deliberately along with product sign-off.
  it("delegates screenshot (20) to the SDK — NOT reclassified in this PR", () => {
    hoisted.sdk.isSystemMessage.mockReturnValueOnce(false);

    expect(isCurrentImSystemMessage(20)).toBe(false);

    // The delegating path must have been taken.
    expect(hoisted.sdk.isSystemMessage).toHaveBeenCalledWith(20);
  });
});
