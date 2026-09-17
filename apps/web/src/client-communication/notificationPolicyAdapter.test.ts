import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OctoBuddyCommunicationBridge } from "./hostBridge";

const store = vi.hoisted(() => ({
  applyRemoteCMD: vi.fn().mockReturnValue(true),
  refresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@octo/base/src/Components/NavRail/QuickMuteStore", () => ({ quickMuteStore: store }));

let policy: typeof import("@octo/base/src/features/notifications");
let install: typeof import("./notificationPolicyAdapter")["installHostNotificationPolicyAdapter"];
const preferences = { version: 1, desktopNotifications: true, soundNotifications: true, quickMuteScope: "popup" } as const;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  store.applyRemoteCMD.mockReturnValue(true);
  policy = await import("@octo/base/src/features/notifications");
  install = (await import("./notificationPolicyAdapter")).installHostNotificationPolicyAdapter;
});

function fixture(capabilities = { preferences: true, pause: true }) {
  let callback!: (value: unknown) => void;
  const off = vi.fn();
  const host = {
    ...(capabilities.preferences ? { getNotificationPreferences: vi.fn().mockResolvedValue(preferences) } : {}),
    ...(capabilities.pause ? {
      onNotificationPauseChanged: (listener: typeof callback) => { callback = listener; return off; },
    } : {}),
  } as unknown as OctoBuddyCommunicationBridge;
  const dispose = install(host);
  return { host, dispose, off, emit: (value: unknown) => callback(value) };
}

describe("Client notification adapter", () => {
  it("preserves old hosts with neither optional method", async () => {
    install({} as OctoBuddyCommunicationBridge)();
    expect(policy.hasNotificationProvider()).toBe(false);
    expect(await policy.getHostNotificationDecision(vi.fn())).toBeNull();
  });

  it("keeps the legacy decision path for a pause-only host, including after disposal", async () => {
    const f = fixture({ preferences: false, pause: true });
    expect(policy.hasNotificationProvider()).toBe(false);
    expect(await policy.resolveNotificationPolicy()).toBeNull();
    for (const active of [false, true]) {
      const event = { paused: active, mode: "manual", revision: active ? 2 : 1 };
      f.emit(event);
      expect(store.applyRemoteCMD).toHaveBeenLastCalledWith(event);
      expect(await policy.getHostNotificationDecision(async () => ({ active, scope: "sound" }))).toBeNull();
    }
    expect(store.refresh).not.toHaveBeenCalled();
    f.dispose();
    f.dispose();
    expect(f.off).toHaveBeenCalledOnce();
    f.emit({ paused: false, revision: 3 });
    expect(store.applyRemoteCMD).toHaveBeenCalledTimes(2);
    expect(policy.hasNotificationProvider()).toBe(false);
    expect(await policy.resolveNotificationPolicy()).toBeNull();
  });

  it("honors host preferences without a pause subscription and closes on disposal", async () => {
    const f = fixture({ preferences: true, pause: false });
    expect(policy.hasNotificationProvider()).toBe(true);
    for (const active of [false, true]) {
      expect(await policy.getHostNotificationDecision(async () => ({ active, scope: "sound-and-popup" })))
        .toMatchObject({ playSound: true, showPopup: !active });
    }
    expect(f.host.getNotificationPreferences).toHaveBeenCalledTimes(2);
    expect(store.applyRemoteCMD).not.toHaveBeenCalled();
    f.dispose();
    f.dispose();
    expect(f.off).not.toHaveBeenCalled();
    expect(await policy.getHostNotificationDecision(vi.fn())).toEqual({ playSound: false, showPopup: false });
  });

  it("does not downgrade to legacy behavior when an available preference query rejects", async () => {
    const f = fixture({ preferences: true, pause: false });
    vi.mocked(f.host.getNotificationPreferences!).mockRejectedValue(new Error("unavailable"));
    expect(await policy.getHostNotificationDecision(vi.fn())).toEqual({ playSound: false, showPopup: false });
    expect(policy.hasNotificationProvider()).toBe(true);
    f.dispose();
  });

  it("reads only host notification preferences and applies pause commands", async () => {
    const f = fixture();
    expect(await policy.resolveNotificationPolicy()).toMatchObject(preferences);
    expect(f.host.getNotificationPreferences).toHaveBeenCalledWith();
    const event = { paused: true, mode: "manual", paused_until: null, revision: 2 };
    f.emit(event);
    expect(store.applyRemoteCMD).toHaveBeenCalledWith(event);
    expect(store.refresh).not.toHaveBeenCalled();
    f.dispose();
  });

  it.each([
    ["malformed", {}],
    ["stale", { paused: false, revision: 1 }],
  ])("leaves %s event reconciliation to the store without an extra refresh", (_name, event) => {
    const f = fixture();
    store.applyRemoteCMD.mockReturnValue(false);
    f.emit(event);
    expect(store.applyRemoteCMD).toHaveBeenCalledWith(event);
    expect(store.refresh).not.toHaveBeenCalled();
    f.dispose();
  });

  it("unsubscribes once and ignores already queued events after disposal", async () => {
    const f = fixture();
    f.dispose();
    f.dispose();
    expect(f.off).toHaveBeenCalledOnce();
    f.emit({ paused: false });
    expect(store.applyRemoteCMD).not.toHaveBeenCalled();
    expect(store.refresh).not.toHaveBeenCalled();
    await expect(policy.resolveNotificationPolicy()).rejects.toThrow("disposed");
  });

  it("an older adapter cleanup does not dispose the new account's provider", async () => {
    const older = fixture();
    const current = fixture();
    older.dispose();
    expect((await policy.resolveNotificationPolicy())!.isCurrent()).toBe(true);
    current.dispose();
  });
});
