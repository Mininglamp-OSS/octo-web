import { describe, expect, it, vi } from "vitest";
import { installFeatureAuthExpiryHandler } from "./authLifecycle";

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
