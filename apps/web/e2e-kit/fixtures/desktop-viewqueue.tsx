import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import WKApp, { ThemeMode } from "../../../../packages/dmworkbase/src/App";
import WKViewQueue, { type WKViewQueueContext } from "../../../../packages/dmworkbase/src/Components/WKViewQueue";
import WKViewQueueHeader from "../../../../packages/dmworkbase/src/Components/WKViewQueueHeader";
import { I18nProvider, i18n } from "../../../../packages/dmworkbase/src/i18n";
import type { ICommonDataSource } from "../../../../packages/dmworkbase/src/Service/DataSource/DataSource";
import { FriendAdd } from "../../../../packages/dmworkcontacts/src/FriendAdd";
import enUS from "../../../../packages/dmworkcontacts/src/i18n/en-US.json";
import zhCN from "../../../../packages/dmworkcontacts/src/i18n/zh-CN.json";
import "../../../../packages/dmworkbase/src/theme/index.css";
import "../../../../packages/dmworkbase/src/App.css";
import "../../src/client-feature/desktop/presentation.css";
import "../../src/client-communication/desktop-presentation.css";
import { installDesktopPresentation, type DesktopPresentation } from "../../src/client-feature/desktop/presentation";

if (!import.meta.env.DEV) throw new Error("Test fixture requires a development server");

const params = new URLSearchParams(location.search);
const platform = params.get("platform") ?? "darwin";
const fullScreen = params.has("fullscreen");
const offset = Number(params.get("offset") ?? 64);
const panelWidth = Number(params.get("width") ?? 300);
const root = document.getElementById("root")!;
document.body.setAttribute("theme-mode", params.get("theme") ?? "light");
WKApp.config.appName = "Octo";
WKApp.config.themeMode = params.get("theme") === "dark" ? ThemeMode.dark : ThemeMode.light;
i18n.registerNamespace("contacts", { "en-US": enUS, "zh-CN": zhCN });
i18n.init({ locale: "en-US" });
WKApp.loginInfo.uid = "header-fixture";
WKApp.loginInfo.name = "Header Fixture";
WKApp.loginInfo.shortNo = "fixture";
WKApp.shared.avatarUser = () => "/logo192.png";
// Exercise the production pages without signing in or calling a live API.
WKApp.dataSource.commonDataSource = {
  qrcodeMy: async () => ({ data: "octo://header-fixture" }),
} as ICommonDataSource;

function ViewQueueFixture() {
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    if (platform === "web") return;
    const state = (): DesktopPresentation => {
      const headerHeight = platform === "darwin" ? 52 : 48;
      const controlsWidth = platform === "darwin" ? 96 : 138;
      return {
        version: 1, revision: 1, platform: platform === "darwin" ? "darwin" : "win32",
        canFuse: true, headerHeight, fallbackHeight: headerHeight,
        topArea: { x: 0, y: 0, width: innerWidth, height: headerHeight },
        controls: fullScreen ? [] : [{
          x: platform === "darwin" ? 0 : innerWidth - controlsWidth,
          y: 0, width: controlsWidth, height: headerHeight,
        }],
        focused: true, maximized: false, fullScreen,
      };
    };
    let active = true;
    let release: (() => void) | null = null;
    void installDesktopPresentation({
      getDesktopPresentation: async () => state(),
      onDesktopPresentation: () => () => {},
    }, root).then(dispose => {
      if (active) release = dispose;
      else dispose?.();
    });
    return () => { active = false; release?.(); };
  }, []);

  function bindRoute(context: WKViewQueueContext) {
    WKApp.routeLeft.setPush = view => context.push(view);
    WKApp.routeLeft.setReplaceToRoot = view => context.replaceToRoot(view);
    WKApp.routeLeft.setPop = () => context.pop();
    WKApp.routeLeft.setPopToRoot = () => context.popToRoot();
    context.addRouteListener(() => setDepth(context.viewCount()));
  }

  return (
    <I18nProvider>
      <aside style={{ marginLeft: offset, width: panelWidth, maxWidth: `calc(100% - ${offset}px)`, height: "100%" }}>
        <WKViewQueue onContext={bindRoute}>
          <WKViewQueueHeader title="Messages" hideBack />
          <button onClick={() => WKApp.routeLeft.push(<FriendAdd onBack={() => WKApp.routeLeft.pop()} />)}>
            Add friend
          </button>
        </WKViewQueue>
      </aside>
      <output data-testid="route-depth" style={{ position: "fixed", right: 0, bottom: 0 }}>{depth}</output>
    </I18nProvider>
  );
}

createRoot(root).render(<ViewQueueFixture />);
