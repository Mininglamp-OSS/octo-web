import { beforeEach, describe, expect, it, vi } from "vitest";

let policy: typeof import("./notificationPolicy");
const preferences = { version: 1, desktopNotifications: true, soundNotifications: true, quickMuteScope: "popup" };
beforeEach(async () => {
  vi.resetModules();
  policy = await import("./notificationPolicy");
});

describe("host policy lifetime and validation", () => {
  it("does not install policy for ordinary Web", async () => {
    expect(policy.hasNotificationProvider()).toBe(false);
    expect(await policy.resolveNotificationPolicy()).toBeNull();
    expect(await policy.getHostNotificationDecision(vi.fn())).toBeNull();
  });

  it("returns a lease that expires on disposal and never restores Web defaults", async () => {
    const dispose = policy.installNotificationProvider({ getPreferences: async () => preferences });
    const resolved = await policy.resolveNotificationPolicy();
    expect(resolved).toMatchObject(preferences);
    expect(resolved!.isCurrent()).toBe(true);
    dispose();
    dispose();
    expect(resolved!.isCurrent()).toBe(false);
    expect(policy.hasNotificationProvider()).toBe(true);
    await expect(policy.resolveNotificationPolicy()).rejects.toThrow("disposed");
  });

  it("older cleanup cannot revoke a newer installation, including the same provider object", async () => {
    const provider = { getPreferences: async () => preferences };
    const old = policy.installNotificationProvider(provider);
    policy.installNotificationProvider(provider);
    old();
    old();
    expect((await policy.resolveNotificationPolicy())!.isCurrent()).toBe(true);
  });

  it("accepts additive v1 fields without forwarding them or overriding the lease", async () => {
    policy.installNotificationProvider({
      getPreferences: async () => ({ ...preferences, unrelated: "field", isCurrent: false }),
    });
    const resolved = await policy.resolveNotificationPolicy();
    expect(resolved).toEqual({ ...preferences, isCurrent: expect.any(Function) });
    expect(resolved!.isCurrent()).toBe(true);
    expect(await policy.getHostNotificationDecision(async () => ({ active: false, scope: "sound-and-popup" })))
      .toMatchObject({ playSound: true, showPopup: true });
  });

  for (const invalid of [
    null, [], {}, { ...preferences, version: 2 }, { ...preferences, desktopNotifications: 1 },
    { ...preferences, soundNotifications: "yes" }, { ...preferences, quickMuteScope: "sound" },
    { version: 1, unrelated: "field" }, { ...preferences, soundNotifications: undefined, unrelated: "field" },
  ]) {
    it(`rejects malformed preference payload ${JSON.stringify(invalid)}`, async () => {
      policy.installNotificationProvider({ getPreferences: async () => invalid });
      await expect(policy.resolveNotificationPolicy()).rejects.toThrow("Invalid");
    });
  }

  it("invalidates an in-flight preference response after replacement", async () => {
    let complete!: (value: unknown) => void;
    policy.installNotificationProvider({
      getPreferences: () => new Promise(resolve => { complete = resolve; }),
    });
    const pending = policy.resolveNotificationPolicy();
    policy.installNotificationProvider({ getPreferences: async () => preferences });
    complete(preferences);
    await expect(pending).rejects.toThrow("disposed");
  });

  it("fails closed if the pause read rejects", async () => {
    policy.installNotificationProvider({ getPreferences: async () => preferences });
    expect(await policy.getHostNotificationDecision(async () => { throw new Error("offline"); }))
      .toEqual({ playSound: false, showPopup: false });
  });
});
