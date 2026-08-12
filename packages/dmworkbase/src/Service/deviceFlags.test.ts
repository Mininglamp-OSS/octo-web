import { beforeEach, describe, expect, it } from "vitest";
import {
  getExpectedImDeviceFlag,
  hasImDeviceFlagMismatch,
  IM_DEVICE_FLAG_PC,
  IM_DEVICE_FLAG_WEB,
  clearDeviceFlagMigration,
  hasDeviceFlagMigration,
  markDeviceFlagMigration,
} from "./deviceFlags";

beforeEach(() => {
  localStorage.clear();
});

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

  it("persists the migration marker across renderer sessions and clears it for the replacement session", () => {
    markDeviceFlagMigration("sid-1");
    expect(hasDeviceFlagMigration("sid-1")).toBe(true);
    expect(hasDeviceFlagMigration("sid-2")).toBe(false);

    clearDeviceFlagMigration("sid-1");
    expect(hasDeviceFlagMigration("sid-1")).toBe(false);
  });
});
