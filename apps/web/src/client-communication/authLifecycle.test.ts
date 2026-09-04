import { describe, expect, it, vi } from "vitest";
import { installCommunicationAuthExpiryHandler } from "./authLifecycle";

describe("installCommunicationAuthExpiryHandler", () => {
  it("clears the renderer session and reports expiration once", () => {
    const apiClient: { logoutCallback?: () => void } = {};
    const loginInfo = { logout: vi.fn() };
    const bridge = { reportAuthExpired: vi.fn() };

    installCommunicationAuthExpiryHandler(
      apiClient,
      loginInfo,
      bridge as never
    );

    apiClient.logoutCallback?.();
    apiClient.logoutCallback?.();

    expect(loginInfo.logout).toHaveBeenCalledTimes(1);
    expect(bridge.reportAuthExpired).toHaveBeenCalledWith(
      "Communication session expired"
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

    installCommunicationAuthExpiryHandler(
      apiClient,
      loginInfo,
      bridge as never
    );

    expect(() => apiClient.logoutCallback?.()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[client-communication] failed to report expired session",
      error
    );
    consoleSpy.mockRestore();
  });
});
