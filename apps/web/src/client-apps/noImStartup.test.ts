// @vitest-environment jsdom
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareFeatureEntryBoot } from "../client-feature/entryBootHarness";

const fakes = vi.hoisted(() => ({
  render: vi.fn(),
  enableClientFeatureMocks: vi.fn(async () => {}),
}));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: fakes.render }),
}));
vi.mock("./AppsShell", () => ({ AppsShell: () => null }));
vi.mock("../client-feature/e2eMocks", () => ({
  enableClientFeatureMocks: fakes.enableClientFeatureMocks,
}));
vi.mock("@douyinfe/semi-ui", () => ({ default: {} }));
vi.mock("@douyinfe/semi-icons", () => ({ default: {} }));

describe("Apps real artifact entry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv("VITE_E2E_MOCK_IM", "0");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["0", "1"])("boots without IM and handles HTTP 401 with VITE_E2E_MOCK=%s", async (mock) => {
    vi.stubEnv("VITE_E2E_MOCK", mock);
    const boot = await prepareFeatureEntryBoot("apps");
    try {
      await import("./index");
      await vi.waitFor(() => expect(fakes.render).toHaveBeenCalledTimes(1));

      expect(boot.bridge.reportFatalError).not.toHaveBeenCalled();
      expect(boot.baseInit).toHaveBeenCalledTimes(1);
      expect(boot.datasourceInit).toHaveBeenCalledTimes(1);
      expect(fakes.enableClientFeatureMocks).toHaveBeenCalledWith("apps");
      expect(boot.WKApp.loginInfo.uid).toBe(boot.bootstrap.session.uid);
      expect(boot.WKApp.shared.currentSpaceId).toBe(boot.bootstrap.space.id);
      expect(boot.startup).not.toHaveBeenCalled();
      expect(boot.connectIM).not.toHaveBeenCalled();
      expect(boot.sdkConnect).not.toHaveBeenCalled();

      axios.defaults.adapter = async (config) => {
        throw Object.assign(new Error("Unauthorized"), {
          config,
          response: {
            status: 401, statusText: "Unauthorized", headers: {}, config,
            data: { status: 401, msg: "Session expired" },
          },
        });
      };
      await expect(boot.WKApp.apiClient.get("/entry-auth-check"))
        .rejects.toMatchObject({ status: 401 });
      expect(boot.logout).toHaveBeenCalledTimes(1);
      expect(boot.bridge.reportAuthExpired).toHaveBeenCalledWith("Apps session expired");
    } finally {
      boot.cleanup();
    }
  });
});
