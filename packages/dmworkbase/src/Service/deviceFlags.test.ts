import { describe, expect, it } from "vitest";
import {
  getExpectedImDeviceFlag,
  hasImDeviceFlagMismatch,
  IM_DEVICE_FLAG_PC,
  IM_DEVICE_FLAG_WEB,
} from "./deviceFlags";

describe("device flag migration", () => {
  it("uses the PC slot for Electron and the web slot elsewhere", () => {
    expect(getExpectedImDeviceFlag(true)).toBe(IM_DEVICE_FLAG_PC);
    expect(getExpectedImDeviceFlag(false)).toBe(IM_DEVICE_FLAG_WEB);
  });

  it("detects a logged-in session with a missing or stale marker", () => {
    expect(hasImDeviceFlagMismatch(true, undefined, IM_DEVICE_FLAG_PC)).toBe(true);
    expect(hasImDeviceFlagMismatch(true, IM_DEVICE_FLAG_WEB, IM_DEVICE_FLAG_PC)).toBe(true);
    expect(hasImDeviceFlagMismatch(true, IM_DEVICE_FLAG_PC, IM_DEVICE_FLAG_PC)).toBe(false);
    expect(hasImDeviceFlagMismatch(false, undefined, IM_DEVICE_FLAG_PC)).toBe(false);
  });
});
