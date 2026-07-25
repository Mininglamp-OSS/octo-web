import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncCurrentImReminders } from "./currentReminderRuntime";

const hoisted = vi.hoisted(() => {
  const sdk = {
    reminderManager: {
      sync: vi.fn(),
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

describe("currentReminderRuntime", () => {
  beforeEach(() => {
    hoisted.shared.mockClear();
    hoisted.sdk.reminderManager.sync.mockReset();
  });

  it("syncs reminders on the current SDK runtime", () => {
    syncCurrentImReminders();

    expect(hoisted.shared).toHaveBeenCalledTimes(1);
    expect(hoisted.sdk.reminderManager.sync).toHaveBeenCalledTimes(1);
  });
});
