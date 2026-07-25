import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  messageReaction: { read: true, write: false } as
    | { read: boolean; write: boolean }
    | undefined,
}));

vi.mock("../../App", () => ({
  default: {
    remoteConfig: {
      get messageReaction() {
        return mockState.messageReaction;
      },
    },
  },
}));

import {
  canReadMessageReaction,
  canWriteMessageReaction,
} from "../featureFlags";

describe("message reaction remote capabilities", () => {
  beforeEach(() => {
    mockState.messageReaction = { read: true, write: false };
  });

  it("allows rendering but not writes in read-only mode", () => {
    expect(canReadMessageReaction()).toBe(true);
    expect(canWriteMessageReaction()).toBe(false);
  });

  it("allows both operations in read-write mode", () => {
    mockState.messageReaction = { read: true, write: true };
    expect(canReadMessageReaction()).toBe(true);
    expect(canWriteMessageReaction()).toBe(true);
  });

  it("defensively requires read before write", () => {
    mockState.messageReaction = { read: false, write: true };
    expect(canReadMessageReaction()).toBe(false);
    expect(canWriteMessageReaction()).toBe(false);
  });

  it("falls back to the documented read-only mode when config is unavailable", () => {
    mockState.messageReaction = undefined;
    expect(canReadMessageReaction()).toBe(true);
    expect(canWriteMessageReaction()).toBe(false);
  });
});
