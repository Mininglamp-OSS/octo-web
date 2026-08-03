import { describe, expect, it, vi } from "vitest";

import {
  addImTaskListener,
  type ImTaskRuntimeSdk,
} from "./taskRuntime";

function createSdk() {
  return {
    taskManager: {
      addListener: vi.fn(),
    },
  } satisfies ImTaskRuntimeSdk;
}

describe("taskRuntime", () => {
  it("adds task listeners through the SDK task manager", () => {
    const sdk = createSdk();
    const listener = vi.fn();

    addImTaskListener(sdk, listener);

    expect(sdk.taskManager.addListener).toHaveBeenCalledWith(listener);
  });
});
