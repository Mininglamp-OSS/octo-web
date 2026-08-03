import { describe, expect, it, vi } from "vitest";

import { syncImReminders, type ImReminderRuntimeSdk } from "./reminderRuntime";

function createSdk() {
  return {
    reminderManager: {
      sync: vi.fn(),
    },
  } satisfies ImReminderRuntimeSdk;
}

describe("reminderRuntime", () => {
  it("syncs reminders through the SDK reminder manager", () => {
    const sdk = createSdk();

    syncImReminders(sdk);

    expect(sdk.reminderManager.sync).toHaveBeenCalledTimes(1);
  });
});
