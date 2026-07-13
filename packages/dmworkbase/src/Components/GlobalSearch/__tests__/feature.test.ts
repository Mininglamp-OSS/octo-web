import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  remoteConfig: {
    messagesSearchOn: undefined as boolean | undefined,
  },
}));

vi.mock("../../../App", () => ({
  default: {
    remoteConfig: mockState.remoteConfig,
  },
}));

import { isGlobalContentSearchEnabled } from "../feature";

describe("isGlobalContentSearchEnabled", () => {
  it("is false when messagesSearchOn is unset", () => {
    mockState.remoteConfig.messagesSearchOn = undefined;
    expect(isGlobalContentSearchEnabled()).toBe(false);
  });

  it("is false when messagesSearchOn is false", () => {
    mockState.remoteConfig.messagesSearchOn = false;
    expect(isGlobalContentSearchEnabled()).toBe(false);
  });

  it("is true when messagesSearchOn is true", () => {
    mockState.remoteConfig.messagesSearchOn = true;
    expect(isGlobalContentSearchEnabled()).toBe(true);
  });
});
