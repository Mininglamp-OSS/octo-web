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
  i18n,
} from "@octo/base";
import { ContactsModule } from "@octo/contacts";
import { DataSourceModule } from "@octo/datasource";
import { SummaryModule } from "@dmwork/summary";
import { registerEnterpriseModules } from "virtual:octo-enterprise-modules";
import { version as pkgVersion } from "../../package.json";
import { resolveApiURL } from "../apiURL";
import appEnUS from "../i18n/en-US.json";
import appZhCN from "../i18n/zh-CN.json";
import { CommunicationShell } from "./CommunicationShell";
import { requireHostBridge } from "./hostBridge";

async function main() {
  const host = requireHostBridge();
  const bootstrap = await host.getBootstrap();
  if (bootstrap.bridgeVersion !== 1) {
    throw new Error(`Unsupported communication bridge version: ${bootstrap.bridgeVersion}`);
  }

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

  WKApp.shared.registerModule(new BaseModule());
  WKApp.shared.registerModule(new DataSourceModule());
  WKApp.shared.registerModule(new ContactsModule());
  WKApp.shared.registerModule(new SummaryModule());
  registerEnterpriseModules({
    registerModule: (module) => WKApp.shared.registerModule(module),
  });

  await enableMocksIfE2E();
  await enableMockImIfE2E();
  WKApp.shared.startup({ loadLoginInfo: false });
  WKApp.config.themeMode = bootstrap.appearance.theme === "dark" ? ThemeMode.dark : ThemeMode.light;
  document.documentElement.dataset.theme = bootstrap.appearance.theme;
  Dap.shared.init();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <CommunicationShell
          initialPage={bootstrap.initialPage}
          onReady={() => host.reportReady({
            bridgeVersion: 1,
            page: bootstrap.initialPage,
            spaceId: bootstrap.space.id,
            rendererVersion: WKApp.config.appVersion,
          })}
        />
      </I18nProvider>
    </React.StrictMode>,
  );
}

async function enableMocksIfE2E(): Promise<void> {
  if (import.meta.env.VITE_E2E_MOCK !== "1") return;
  try {
    const { worker } = await import("../mocks/browser");
    await worker.start({ onUnhandledRequest: "bypass" });
  } catch (error) {
    console.warn("[communication-e2e] MSW disabled:", error);
  }
}

async function enableMockImIfE2E(): Promise<void> {
  if (import.meta.env.VITE_E2E_MOCK_IM !== "1") return;
  try {
    const mod = await import("../../e2e-kit/_kit/mock-im-runtime/fake-provider");
    const wksdk = await import("wukongimjssdk");
    const defaultSeed = {
      currentUid: "e2e-user",
      spaceId: "e2e-space",
      users: [
        {
          uid: "e2e-contact-human",
          name: "E2E 联系人",
          robot: 0,
          extra: { follow: 1 },
        },
        {
          uid: "e2e-contact-bot",
          name: "E2E 助手",
          robot: 1,
          extra: { follow: 1, robot: 1 },
        },
      ],
      groups: [
        {
          group_no: "e2e-contact-group",
          name: "E2E 项目群",
          extra: { member_count: 3 },
        },
      ],
      conversations: [],
      messages: [],
      subscribers: [],
    };
    (window as unknown as {
      __installMockImRuntime__: (seed: unknown) => void;
      WKSDK: typeof wksdk.WKSDK;
    }).__installMockImRuntime__ = mod.installFakeProvider as (seed: unknown) => void;
    (window as unknown as { WKSDK: typeof wksdk.WKSDK }).WKSDK = wksdk.WKSDK;
    mod.installFakeProvider(defaultSeed);
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

void main().catch((error) => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  window.octoBuddyCommunication?.reportFatalError({
    message: normalized.message,
    stack: normalized.stack,
  });
  const root = document.getElementById("root");
  if (root) root.textContent = `通信模块启动失败：${normalized.message}`;
});
