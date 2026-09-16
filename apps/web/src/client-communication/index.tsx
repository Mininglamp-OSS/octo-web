import "@octo/base/src/theme/tokens.css";
import "../index.css";
import {
  BaseModule,
  Dap,
  IM_DEVICE_FLAG_PC,
  ThemeMode,
  WKApp,
  i18n,
} from "@octo/base";
import { ContactsModule } from "@octo/contacts";
import { DataSourceModule } from "@octo/datasource";
import { SummaryCommunicationModule } from "@dmwork/summary/communication";
import { registerEnterpriseModules } from "virtual:octo-enterprise-modules";
import { WKSDK } from "wukongimjssdk";
import { version as pkgVersion } from "../../package.json";
import { resolveApiURL } from "../apiURL";
import appEnUS from "../i18n/en-US.json";
import appZhCN from "../i18n/zh-CN.json";
import { installCommunicationAuthExpiryHandler } from "./authLifecycle";
import { assertClientFeatureBootstrap } from "../client-feature/bootstrapContract";
import { enableClientFeatureMocks } from "../client-feature/e2eMocks";
import { requireHostBridge } from "./hostBridge";
import { reportStartupFailure } from "./startupFailure";
import { installHostForwardSurface } from "./forwardSurface";
import { resolveForwardSurfaceAvatar } from "./forwardSurfaceAvatar";
import { assertBackgroundRuntimeHost, startCommunicationRuntime } from "./runtime/start";
import "../client-feature/desktop/presentation.css";
import "./desktop-presentation.css";
import "./desktop-contacts.css";

async function main() {
  const host = requireHostBridge();
  const bootstrap = await host.getBootstrap();
  assertClientFeatureBootstrap(bootstrap, "communication");
  assertBackgroundRuntimeHost(host, bootstrap);
  const disposeForwardSurface = installHostForwardSurface(host, resolveForwardSurfaceAvatar);
  window.addEventListener("pagehide", disposeForwardSurface, { once: true });

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
  document.documentElement.dataset.spaceId = bootstrap.space.id;

  i18n.registerNamespace("app", {
    "zh-CN": appZhCN,
    "en-US": appEnUS,
  });
  WKApp.config.locale = bootstrap.appearance.locale;
  i18n.init({ locale: bootstrap.appearance.locale });
  document.documentElement.lang = bootstrap.appearance.locale;

  WKApp.shared.registerModule(new BaseModule());
  installCommunicationAuthExpiryHandler(WKApp.apiClient, WKApp.loginInfo, host);
  WKApp.shared.registerModule(new DataSourceModule());
  WKApp.shared.registerModule(new ContactsModule());
  WKApp.shared.registerModule(new SummaryCommunicationModule());
  registerEnterpriseModules({
    registerModule: (module) => WKApp.shared.registerModule(module),
  });

  await enableClientFeatureMocks("communication");
  await enableMockImIfE2E();
  WKApp.shared.startup({ loadLoginInfo: false, isPC: true });
  if (
    WKApp.loginInfo.deviceFlag !== IM_DEVICE_FLAG_PC ||
    WKSDK.shared().config.deviceFlag !== IM_DEVICE_FLAG_PC
  ) {
    throw new Error("Communication renderer requires the PC IM device flag");
  }
  WKApp.config.themeMode = bootstrap.appearance.theme === "dark" ? ThemeMode.dark : ThemeMode.light;
  document.documentElement.dataset.theme = bootstrap.appearance.theme;
  Dap.shared.init();

  if (bootstrap.runtime) {
    await startCommunicationRuntime(host, bootstrap);
  } else {
    const { mountCommunicationUi } = await import("./mountUi");
    await mountCommunicationUi(host, bootstrap);
  }
}

async function enableMockImIfE2E(): Promise<void> {
  if (import.meta.env.VITE_E2E_MOCK_IM !== "1") return;
  try {
    const [mod, seedModule] = await Promise.all([
      import("../../e2e-kit/_kit/mock-im-runtime/fake-provider"),
      import("../../e2e-kit/_kit/mock-im-runtime/communication-seed"),
    ]);
    const wksdk = await import("wukongimjssdk");
    (window as unknown as {
      __installMockImRuntime__: (seed: unknown) => void;
      WKSDK: typeof wksdk.WKSDK;
    }).__installMockImRuntime__ = mod.installFakeProvider as (seed: unknown) => void;
    (window as unknown as { WKSDK: typeof wksdk.WKSDK }).WKSDK = wksdk.WKSDK;
    mod.installFakeProvider(seedModule.communicationDefaultSeed);
    (window as unknown as {
      __octoCommunicationE2E__?: {
        getOpenChannel: () => { channelID?: string; channelType?: number } | null;
      };
    }).__octoCommunicationE2E__ = {
      getOpenChannel: () => WKApp.shared.openChannel || null,
    };
  } catch (error) {
    console.warn("[communication-e2e] mock IM disabled:", error);
  }
}

void main().catch(reportStartupFailure);
