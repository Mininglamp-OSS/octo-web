import { describe, expect, it } from "vitest";

import { groupRuntimesIntoDevices } from "../runtimeDevices";
import type { RuntimeDevice } from "../../api/types";

const rt = (over: Partial<RuntimeDevice>): RuntimeDevice =>
  ({
    id: "r",
    workspace_id: "w",
    name: "n",
    runtime_mode: "built_in",
    provider: "codex",
    status: "online",
    device_info: "",
    visibility: "workspace",
    last_seen_at: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as RuntimeDevice;

describe("groupRuntimesIntoDevices", () => {
  it("groups by daemon_id and folds the shared custom_name / ownership", () => {
    const devices = groupRuntimesIntoDevices([
      rt({ id: "a", daemon_id: "d1", provider: "codex", custom_name: "王登的设备", can_bind: true }),
      rt({ id: "b", daemon_id: "d1", provider: "claude", custom_name: "王登的设备", can_bind: true }),
    ]);
    expect(devices).toHaveLength(1);
    expect(devices[0].runtimes).toHaveLength(2);
    expect(devices[0].customName).toBe("王登的设备");
    expect(devices[0].ownedByMe).toBe(true);
  });

  it("falls back to the hostname when a daemon reports no daemon_id", () => {
    const devices = groupRuntimesIntoDevices([
      rt({ id: "a", daemon_id: null, device_info: "MacBook·macOS", provider: "codex" }),
      rt({ id: "b", daemon_id: null, device_info: "MacBook·macOS", provider: "claude" }),
    ]);
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe("MacBook");
    expect(devices[0].ownedByMe).toBe(false);
  });

  it("labels a shared-hostname mixed-owner group from the OWNED runtime, not another member's name", () => {
    // Two physical machines with the same hostname and no daemon_id collapse
    // into one fallback group. The header must show the caller's own machine
    // name (the rename target), never the other member's — regardless of order.
    const theirs = rt({ id: "theirs", daemon_id: null, device_info: "MacBook·macOS", custom_name: "别人的设备", can_bind: false });
    const mine = rt({ id: "mine", daemon_id: null, device_info: "MacBook·macOS", custom_name: "我的设备", can_bind: true });

    for (const order of [[theirs, mine], [mine, theirs]]) {
      const [device] = groupRuntimesIntoDevices(order);
      expect(device.customName).toBe("我的设备");
      expect(device.ownedByMe).toBe(true);
    }
  });

  it("does NOT borrow a non-owned sibling's name when the owned runtime is unnamed/cleared", () => {
    // Owned machine exists but has no custom_name (never named, or cleared);
    // a non-owned machine in the same shared-hostname group is named. The header
    // must NOT show the non-owned name (the pencil targets the owned runtime).
    const theirs = rt({ id: "theirs", daemon_id: null, device_info: "MacBook·macOS", custom_name: "别人的设备", can_bind: false });
    const mine = rt({ id: "mine", daemon_id: null, device_info: "MacBook·macOS", custom_name: null, can_bind: true });

    for (const order of [[theirs, mine], [mine, theirs]]) {
      const [device] = groupRuntimesIntoDevices(order);
      expect(device.customName).toBeNull();
      expect(device.ownedByMe).toBe(true);
    }
  });

  it("derives the base name from the owned runtime even when a non-owned row is first in the group", () => {
    // Same group key (daemon_id) but the non-owned row is first and carries a
    // different device name; the owned runtime is unnamed. The header base name
    // must come from the owned runtime (the rename target), never the first row.
    const theirsFirst = rt({ id: "theirs", daemon_id: "shared", device_info: "TheirBox·linux", custom_name: null, can_bind: false });
    const mine = rt({ id: "mine", daemon_id: "shared", device_info: "MyBox·macOS", custom_name: null, can_bind: true });
    const [device] = groupRuntimesIntoDevices([theirsFirst, mine]);
    expect(device.name).toBe("MyBox");
    expect(device.customName).toBeNull();
    expect(device.ownedByMe).toBe(true);
  });

  it("shows any custom_name for a group the caller does not own (no rename entry)", () => {
    const [device] = groupRuntimesIntoDevices([
      rt({ id: "a", daemon_id: "d2", custom_name: "共享机", can_bind: false }),
    ]);
    expect(device.customName).toBe("共享机");
    expect(device.ownedByMe).toBe(false);
  });

  it("leaves customName null when no runtime has a custom_name", () => {
    const [device] = groupRuntimesIntoDevices([
      rt({ id: "a", daemon_id: "d3", device_info: "Linux·x86", can_bind: true }),
    ]);
    expect(device.customName).toBeNull();
    expect(device.name).toBe("Linux");
  });
});
