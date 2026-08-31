import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../Utils/NotificationUtil", () => ({
  NotificationUtil: {
    getInstance: () => ({
      isNotificationSupported: () => false,
      requestPermission: async () => "denied",
    }),
  },
}));

import { createKeepAwakeAdapter } from "../adapters/keepAwakeAdapter";
import { createNotificationAdapter } from "../adapters/notificationAdapter";
import { createTrustedDomainsAdapter } from "../adapters/trustedDomainsAdapter";
import { detectRuntimeEnvironment } from "../runtimeEnvironment";

const webEnvironment = {
  target: "web" as const,
  shell: null,
  os: "unknown" as const,
  capabilities: new Set(["voiceInput" as const]),
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { ipc?: unknown }).ipc;
  delete (window as Window & { electronNotification?: unknown }).electronNotification;
  delete (window as Window & { __POWERED_ELECTRON__?: boolean }).__POWERED_ELECTRON__;
});

describe("runtime adapters", () => {
  it("returns an unsupported web notification adapter when Notification is absent", async () => {
    vi.stubGlobal("Notification", undefined);
    const adapter = createNotificationAdapter(webEnvironment);

    expect(adapter.isSupported()).toBe(false);
    expect(adapter.getPermission()).toBe("unsupported");
    await expect(adapter.requestPermission()).resolves.toBe("unsupported");
  });

  it("reads the browser notification permission when Web Notification exists", () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    const adapter = createNotificationAdapter(webEnvironment);

    expect(adapter.isSupported()).toBe(true);
    expect(adapter.getPermission()).toBe("granted");
  });

  it("bridges keep-awake reads and writes to Electron IPC", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (window as Window & { ipc?: unknown }).ipc = { invoke };
    const environment = {
      ...webEnvironment,
      target: "desktop" as const,
      shell: "electron" as const,
      capabilities: new Set(["keepAwake" as const]),
    };
    const adapter = createKeepAwakeAdapter(environment);

    await expect(adapter?.getEnabled()).resolves.toBe(true);
    await expect(adapter?.setEnabled(false)).resolves.toBe(false);
    expect(invoke.mock.calls).toEqual([["keep-awake-get"], ["keep-awake-set", false]]);
  });

  it("does not create keep-awake IPC on Web", () => {
    expect(createKeepAwakeAdapter(webEnvironment)).toBeNull();
  });

  it("bridges trusted-domain reads and removals to Electron IPC", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(["example.com"])
      .mockResolvedValueOnce([]);
    (window as Window & { ipc?: unknown }).ipc = { invoke };
    const environment = {
      ...webEnvironment,
      target: "desktop" as const,
      shell: "electron" as const,
      capabilities: new Set(["keepAwake"] as const),
    };
    const adapter = createTrustedDomainsAdapter(environment);

    await expect(adapter?.get()).resolves.toEqual(["example.com"]);
    await expect(adapter?.remove("example.com")).resolves.toEqual([]);
    expect(invoke.mock.calls).toEqual([
      ["trusted-domains-get"],
      ["trusted-domain-remove", "example.com"],
    ]);
  });

  it("does not create trusted-domains IPC on Web", () => {
    expect(createTrustedDomainsAdapter(webEnvironment)).toBeNull();
  });

  it("detects Electron from the user agent and exposes desktop capabilities", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Electron/26.0", platform: "MacIntel" });
    (window as Window & { __POWERED_ELECTRON__?: boolean }).__POWERED_ELECTRON__ = true;
    (window as Window & { ipc?: unknown }).ipc = { invoke: vi.fn() };
    (window as Window & { electronNotification?: unknown }).electronNotification = {};

    const environment = detectRuntimeEnvironment();

    expect(environment).toMatchObject({ target: "desktop", shell: "electron", os: "macos" });
    expect(environment.capabilities.has("keepAwake")).toBe(true);
    expect(environment.capabilities.has("nativeNotifications")).toBe(true);
  });
});
