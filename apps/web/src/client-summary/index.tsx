import React from "react";
import { createRoot } from "react-dom/client";
import "@octo/base/src/theme/tokens.css";
import "../index.css";
import {
  BaseModule,
  Dap,
  I18nProvider,
  IM_DEVICE_FLAG_PC,
  ThemeMode,
  WKApp,
  WKBase,
  i18n,
} from "@octo/base";
import { DataSourceModule } from "@octo/datasource";
import {
  initializeSummaryAttentionRuntime,
  registerSummaryFoundation,
  startSummaryAttentionPolling,
} from "@dmwork/summary";
import { version as pkgVersion } from "../../package.json";
import { resolveApiURL } from "../apiURL";
import appEnUS from "../i18n/en-US.json";
import appZhCN from "../i18n/zh-CN.json";
import { installFeatureAuthExpiryHandler } from "../client-feature/authLifecycle";
import { assertClientFeatureBootstrap } from "../client-feature/bootstrapContract";
import { enableClientFeatureMocks } from "../client-feature/e2eMocks";
import { SummaryShell } from "./SummaryShell";
import { requireSummaryHostBridge } from "./hostBridge";
import { reportSummaryStartupFailure } from "./startupFailure";

async function main() {
  const host = requireSummaryHostBridge();
  const bootstrap = await host.getBootstrap();
  assertClientFeatureBootstrap(bootstrap, "summary");

  WKApp.apiClient.config.apiURL = resolveApiURL({
    isDesktop: true,
    isDev: false,
    rawApiURL: bootstrap.session.apiOrigin,
  });
  WKApp.apiClient.config.tokenCallback = () => WKApp.loginInfo.token;
  WKApp.apiClient.config.spaceIdCallback = () => WKApp.shared.currentSpaceId;
  Dap.shared.setTokenProvider(() => WKApp.loginInfo.token);
  WKApp.config.appVersion = import.meta.env.VITE_VERSION || pkgVersion;
  WKApp.config.appName = "Octo";

  WKApp.loginInfo.applySession({
    uid: bootstrap.session.uid,
    token: bootstrap.session.token,
    name: bootstrap.session.name,
    loginProvider: bootstrap.session.provider,
    deviceFlag: IM_DEVICE_FLAG_PC,
  });
  WKApp.shared.currentSpaceId = bootstrap.space.id;
  WKApp.shared.deviceId = WKApp.shared.getDeviceIdFromStorage();
  WKApp.shared.isPC = true;
  document.documentElement.dataset.spaceId = bootstrap.space.id;

  i18n.registerNamespace("app", {
    "zh-CN": appZhCN,
    "en-US": appEnUS,
  });
  registerSummaryFoundation();
  WKApp.config.locale = bootstrap.appearance.locale;
  i18n.init({ locale: bootstrap.appearance.locale });
  WKApp.config.themeMode =
    bootstrap.appearance.theme === "dark" ? ThemeMode.dark : ThemeMode.light;
  document.documentElement.dataset.theme = bootstrap.appearance.theme;
  document.documentElement.lang = bootstrap.appearance.locale;

  WKApp.shared.registerModule(new BaseModule());
  WKApp.shared.registerModule(new DataSourceModule());
  await enableClientFeatureMocks("summary");
  installFeatureAuthExpiryHandler(WKApp.apiClient, WKApp.loginInfo, host, {
    reason: "Summary session expired",
    logPrefix: "[client-summary]",
  });
  WKApp.remoteConfig.startRequestConfig();
  Dap.shared.init();
  initializeSummaryAttentionRuntime({ observeIm: false });
  WKApp.mittBus.emit("space-ready");
  startSummaryAttentionPolling();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <WKBase onContext={(context) => (WKApp.shared.baseContext = context)}>
          <SummaryShell
            bridge={host}
            initialRoute={bootstrap.initialRoute}
            initialSpaceId={bootstrap.space.id}
            onReady={({ route, spaceId }) =>
              host.reportReady({
                bridgeVersion: 1,
                route,
                spaceId,
                rendererVersion: WKApp.config.appVersion,
              })
            }
          />
        </WKBase>
      </I18nProvider>
    </React.StrictMode>
  );
}

void main().catch(reportSummaryStartupFailure);
