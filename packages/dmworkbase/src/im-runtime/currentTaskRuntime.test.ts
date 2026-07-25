import { beforeEach, describe, expect, it, vi } from "vitest";

import { addCurrentImTaskListener } from "./currentTaskRuntime";

const hoisted = vi.hoisted(() => {
  const sdk = {
    taskManager: {
      addListener: vi.fn(),
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

describe("currentTaskRuntime", () => {
  beforeEach(() => {
    hoisted.shared.mockClear();
    hoisted.sdk.taskManager.addListener.mockReset();
  });

  it("adds task listeners on the current SDK runtime", () => {
    const listener = vi.fn();

    addCurrentImTaskListener(listener);

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.taskManager.addListener).toHaveBeenCalledWith(listener);
  });
});
