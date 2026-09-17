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

function fixture() {
  let callback!: (value: unknown) => void;
  const off = vi.fn();
  const host = {
    getNotificationPreferences: vi.fn().mockResolvedValue(preferences),
    onNotificationPauseChanged: (listener: typeof callback) => { callback = listener; return off; },
  } as unknown as OctoBuddyCommunicationBridge;
  const dispose = install(host);
  return { host, dispose, off, emit: (value: unknown) => callback(value) };
}

describe("Client notification adapter", () => {
  it("preserves old hosts with neither optional method", async () => {
    install({} as OctoBuddyCommunicationBridge)();
    expect(policy.hasNotificationProvider()).toBe(false);
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

  it("refreshes rejected events, unsubscribes once, and ignores already queued events after disposal", async () => {
    const f = fixture();
    store.applyRemoteCMD.mockReturnValue(false);
    f.emit({});
    expect(store.refresh).toHaveBeenCalledOnce();
    f.dispose();
    f.dispose();
    expect(f.off).toHaveBeenCalledOnce();
    f.emit({ paused: false });
    expect(store.applyRemoteCMD).toHaveBeenCalledOnce();
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
