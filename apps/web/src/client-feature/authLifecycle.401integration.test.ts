// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import APIClient from "@octo/base/src/Service/APIClient";
import axios, { type AxiosRequestConfig } from "axios";
import { installFeatureAuthExpiryHandler } from "./authLifecycle";

function apiError(status: number, config: AxiosRequestConfig) {
  return Object.assign(new Error("REJECTED"), {
    config,
    response: {
      status,
      data: status === 401 ? { msg: "login expired", status: 401 } : { msg: "forbidden", status },
      headers: {},
      statusText: "Rejected",
      config,
    },
  });
}

describe("installFeatureAuthExpiryHandler 401 integration via APIClient", () => {
  const client = APIClient.shared;
  let loginInfo: { logout: ReturnType<typeof vi.fn> };
  let bridge: { reportAuthExpired: ReturnType<typeof vi.fn> };
  let originalAdapter: typeof axios.defaults.adapter;

  beforeEach(() => {
    vi.clearAllMocks();
    originalAdapter = axios.defaults.adapter;
    client.config.tokenCallback = undefined;
    client.config.spaceIdCallback = undefined;
    client.logoutCallback = undefined;

    loginInfo = { logout: vi.fn() };
    bridge = { reportAuthExpired: vi.fn() };
  });

  afterEach(() => {
    axios.defaults.adapter = originalAdapter;
    client.config.tokenCallback = undefined;
    client.config.spaceIdCallback = undefined;
    client.logoutCallback = undefined;
  });

  it("fires logoutCallback and reports to host on real API 401 via axios interceptor", async () => {
    installFeatureAuthExpiryHandler(client, loginInfo, bridge, {
      reason: "Feature session expired",
      logPrefix: "[client-feature]",
    });

    axios.defaults.adapter = async (config) => { throw apiError(401, config); };
    await expect(client.get("/private")).rejects.toMatchObject({ status: 401 });
    expect(loginInfo.logout).toHaveBeenCalledTimes(1);
    expect(bridge.reportAuthExpired).toHaveBeenCalledWith("Feature session expired");
  });

  it("does not fire logout for non-auth errors like 403", async () => {
    installFeatureAuthExpiryHandler(client, loginInfo, bridge, {
      reason: "Feature session expired",
      logPrefix: "[client-feature]",
    });

    axios.defaults.adapter = async (config) => { throw apiError(403, config); };
    await expect(client.get("/forbidden")).rejects.toMatchObject({ status: 403 });
    expect(loginInfo.logout).not.toHaveBeenCalled();
    expect(bridge.reportAuthExpired).not.toHaveBeenCalled();
  });
});
