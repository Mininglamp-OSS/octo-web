import { afterEach, describe, expect, it, vi } from "vitest";
import { installFeatureAuthExpiryHandler } from "./authLifecycle";
import { SESSION_CLEANUP_TIMEOUT_MS } from "@octo/base/src/Service/sessionCleanup";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(["hang", "reject", "throw"] as const)("reports expiry exactly once when cleanup can %s", async mode => {
  vi.useFakeTimers();
  const error = new Error("storage unavailable");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const logout = vi.fn(() => {
    if (mode === "throw") throw error;
    if (mode === "reject") return Promise.reject(error);
    return new Promise<void>(() => {});
  });
  const api: { logoutCallback?: () => void } = {};
  const bridge = { reportAuthExpired: vi.fn() };
  installFeatureAuthExpiryHandler(api, { logout }, bridge, { reason: "expired", logPrefix: "[test]" });
  expect(() => { api.logoutCallback?.(); api.logoutCallback?.(); }).not.toThrow();
  expect(logout).toHaveBeenCalledOnce();
  if (mode === "hang") {
    await vi.advanceTimersByTimeAsync(SESSION_CLEANUP_TIMEOUT_MS - 1);
    expect(bridge.reportAuthExpired).not.toHaveBeenCalled();
  }
  await vi.advanceTimersByTimeAsync(SESSION_CLEANUP_TIMEOUT_MS);
  expect(bridge.reportAuthExpired).toHaveBeenCalledExactlyOnceWith("expired");
  expect(log).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for durable cleanup and cancels the timeout when it finishes", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const cleanup = new Promise<void>(resolve => { finish = resolve; });
  const api: { logoutCallback?: () => void } = {};
  const bridge = { reportAuthExpired: vi.fn() };
  installFeatureAuthExpiryHandler(api, { logout: () => cleanup }, bridge, { reason: "expired", logPrefix: "[test]" });
  api.logoutCallback?.();
  expect(bridge.reportAuthExpired).not.toHaveBeenCalled();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(bridge.reportAuthExpired).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

describe("installFeatureAuthExpiryHandler", () => {
  it("clears the renderer session and reports expiration once", () => {
    const apiClient: { logoutCallback?: () => void } = {};
    const loginInfo = { logout: vi.fn() };
    const bridge = { reportAuthExpired: vi.fn() };

    installFeatureAuthExpiryHandler(apiClient, loginInfo, bridge, {
      reason: "Feature session expired",
      logPrefix: "[client-feature]",
    });
    apiClient.logoutCallback?.();
    apiClient.logoutCallback?.();

    expect(loginInfo.logout).toHaveBeenCalledTimes(1);
    expect(bridge.reportAuthExpired).toHaveBeenCalledWith(
      "Feature session expired"
    );
  });

  it("isolates host reporting failures", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const apiClient: { logoutCallback?: () => void } = {};
    const loginInfo = { logout: vi.fn() };
    const error = new Error("ipc unavailable");
    const bridge = {
      reportAuthExpired: vi.fn(() => {
        throw error;
      }),
    };

    installFeatureAuthExpiryHandler(apiClient, loginInfo, bridge, {
      reason: "Feature session expired",
      logPrefix: "[client-feature]",
    });

    expect(() => apiClient.logoutCallback?.()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[client-feature] failed to report expired session",
      error
    );
    consoleSpy.mockRestore();
  });
});
