import axios from "axios";
import { vi } from "vitest";
import fixtures from "./client-feature-contract-v1.fixture.json";

type BootFeature = "apps" | "summary";

export async function prepareFeatureEntryBoot(feature: BootFeature) {
  const requestInterceptors = vi.spyOn(axios.interceptors.request, "use");
  const responseInterceptors = vi.spyOn(axios.interceptors.response, "use");
  const { BaseModule, Dap, WKApp } = await import("@octo/base");
  const { DataSourceModule } = await import("@octo/datasource");
  const { WKSDK } = await import("wukongimjssdk");
  const bootstrap = structuredClone(
    fixtures.valid.find((item) => item.featureId === feature)!.value
  );
  const bridge = {
    getBootstrap: vi.fn(async () => bootstrap),
    reportReady: vi.fn(),
    reportAuthExpired: vi.fn(),
    reportFatalError: vi.fn(),
    onCommand: vi.fn(() => () => {}),
  };
  const key = feature === "apps" ? "octoBuddyApps" : "octoBuddySummary";
  const hostWindow = window as unknown as Record<string, unknown>;
  hostWindow[key] = bridge;
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);

  const previousAdapter = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => ({
    data: {}, status: 200, statusText: "OK", headers: {}, config,
  });
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } })
  ));
  vi.spyOn(WKApp.remoteConfig, "startRequestConfig").mockResolvedValue(undefined);
  vi.spyOn(Dap.shared, "init").mockImplementation(() => {});

  // Observe the real registration path; only block the lowest-level connection.
  const baseInit = vi.spyOn(BaseModule.prototype, "init");
  const datasourceInit = vi.spyOn(DataSourceModule.prototype, "init");
  const startup = vi.spyOn(WKApp.shared, "startup");
  const connectIM = vi.spyOn(WKApp.shared, "connectIM");
  const sdkConnect = vi.spyOn(WKSDK.shared().connectManager, "connect")
    .mockImplementation(() => {});
  const logout = vi.spyOn(WKApp.loginInfo, "logout");

  return {
    bootstrap, bridge, root, WKApp,
    baseInit, datasourceInit, startup, connectIM, sdkConnect, logout,
    cleanup: () => {
      axios.defaults.adapter = previousAdapter;
      requestInterceptors.mock.results.forEach(({ type, value }) => {
        if (type === "return") axios.interceptors.request.eject(value);
      });
      responseInterceptors.mock.results.forEach(({ type, value }) => {
        if (type === "return") axios.interceptors.response.eject(value);
      });
      WKApp.apiClient.logoutCallback = undefined;
      WKApp.mittBus.all.clear();
      delete hostWindow[key];
      root.remove();
      localStorage.clear();
    },
  };
}
