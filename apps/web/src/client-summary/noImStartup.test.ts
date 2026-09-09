// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareFeatureEntryBoot } from "../client-feature/entryBootHarness";

const fakes = vi.hoisted(() => ({
  render: vi.fn(),
  enableClientFeatureMocks: vi.fn(async () => {}),
}));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: fakes.render }),
}));
vi.mock("./SummaryShell", () => ({ SummaryShell: () => null }));
vi.mock("../client-feature/e2eMocks", () => ({
  enableClientFeatureMocks: fakes.enableClientFeatureMocks,
}));
vi.mock("@douyinfe/semi-ui", () => ({
  default: {},
  Typography: { Text: () => null },
}));
vi.mock("@douyinfe/semi-icons", () => ({ default: {} }));

describe("Summary real artifact entry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv("VITE_E2E_MOCK", "0");
    vi.stubEnv("VITE_E2E_MOCK_IM", "0");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Cold imports of the real base/datasource/summary graph can exceed Vitest's
  // default 5 s on CI. Keep the render wait bounded independently by vi.waitFor.
  it("finishes bootstrap and real module initialization without connecting IM", async () => {
    const boot = await prepareFeatureEntryBoot("summary");
    try {
      await import("./index");
      await vi.waitFor(() => expect(fakes.render).toHaveBeenCalledTimes(1));
      expect(boot.bridge.reportFatalError).not.toHaveBeenCalled();
      expect(boot.baseInit).toHaveBeenCalledTimes(1);
      expect(boot.datasourceInit).toHaveBeenCalledTimes(1);
      expect(fakes.enableClientFeatureMocks).toHaveBeenCalledWith("summary");
      expect(boot.WKApp.loginInfo.uid).toBe(boot.bootstrap.session.uid);
      expect(boot.WKApp.shared.currentSpaceId).toBe(boot.bootstrap.space.id);
      expect(boot.startup).not.toHaveBeenCalled();
      expect(boot.connectIM).not.toHaveBeenCalled();
      expect(boot.sdkConnect).not.toHaveBeenCalled();
    } finally {
      const { disposeSummaryAttentionRuntime } = await import("@dmwork/summary");
      disposeSummaryAttentionRuntime();
      boot.cleanup();
    }
  }, 15_000);
});
