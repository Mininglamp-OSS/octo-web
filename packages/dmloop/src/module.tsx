import React from "react";
import { WKApp, Menus, i18n, t as translate } from "@octo/base";
import type { IModule } from "@octo/base";
import { Workflow } from "lucide-react";
import LoopPage from "./pages/LoopPage";
import LoopCliAuthorizePage from "./pages/LoopCliAuthorizePage";
import {
  isLoopCliAuthorizePath,
  LOOP_CLI_AUTHORIZE_PATH,
  resolveLoopCliAuthorizeSearch,
  visibleLoopCliAuthorizeSearch,
} from "./cliAuthorizeSession";
import { normalizeCurrentLoopIssueDeepLink } from "./issueDeepLink";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

let _initialized = false;
let loopCliAuthorizeInitialSearch = "";
// remoteConfig 监听的退订句柄:HMR 重新 init 时先退订旧的,避免 refreshMenus 闭包在共享
// WKApp.remoteConfig 单例上越堆越多(镜像 DocsModule._configUnsubscribers)。
let _configUnsubs: Array<() => void> = [];
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _configUnsubs.forEach((u) => u());
    _configUnsubs = [];
    _initialized = false;
  });
}

function LoopIcon({ active }: { active?: boolean }) {
  const color = active ? "var(--wk-brand-primary, #7C5CFC)" : "currentColor";
  return <Workflow size={22} color={color} strokeWidth={2} />;
}

/** LoopModule — Loop 一级 Panel（二级菜单：Issue/Skill/Project/Agent/Squad）。 */
export default class LoopModule implements IModule {
  id(): string {
    return "LoopModule";
  }

  init(): void {
    if (_initialized) return;
    _initialized = true;

    i18n.registerNamespace("loop", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    // Capture issue deep-links before the host tries to activate a menu route.
    // Only `/loop` has a NavRail entry, so dynamic issue paths are normalized
    // first and restored after Loop resolves the target workspace.
    normalizeCurrentLoopIssueDeepLink();

    if (
      typeof window !== "undefined" &&
      isLoopCliAuthorizePath(window.location.pathname)
    ) {
      loopCliAuthorizeInitialSearch = resolveLoopCliAuthorizeSearch(
        window.location.pathname,
        window.location.search,
        window.sessionStorage
      );

      // RouteManager keeps only `sid` on pageshow. Capture the callback above,
      // then remove it from the address bar before it can remain in history.
      if (new URLSearchParams(window.location.search).get("cli_callback")) {
        try {
          window.history.replaceState(
            {},
            "",
            window.location.pathname +
              visibleLoopCliAuthorizeSearch(window.location.search)
          );
        } catch {
          // The captured prop still protects the flow if History is unavailable.
        }
      }
    }

    WKApp.route.register("/loop", () => <LoopPage />);
    const renderLoopCliAuthorize = () => (
      <LoopCliAuthorizePage
        initialSearch={loopCliAuthorizeInitialSearch}
      />
    );
    WKApp.route.register(LOOP_CLI_AUTHORIZE_PATH, renderLoopCliAuthorize);
    WKApp.route.register(
      `${LOOP_CLI_AUTHORIZE_PATH}/`,
      renderLoopCliAuthorize
    );

    // 上线开关:仅当后端 appconfig `dmloop_on`(WKApp.remoteConfig.dmloopOn)为 true 才在 NavRail
    // 展示「回路」入口,否则工厂返回 undefined(MenusManager 过滤 falsy → 隐藏)。默认 false(fail-safe):
    // 合入 main 也不暴露,运维就绪后下发 dmloop_on=true。镜像 DocsModule(docs_on)。纯显示门,路由仍注册。
    WKApp.menus.register(
      "loop",
      () =>
        WKApp.remoteConfig?.dmloopOn
          ? new Menus(
              "loop",
              "/loop",
              translate("loop.menu.title"),
              <LoopIcon />,
              <LoopIcon active />
            )
          : undefined,
      4003
    );

    // appconfig 异步拉取:init() 时 dmloopOn 通常还是默认 false。dmloop_on resolve / 后续切换时
    // 刷新 NavRail,让「回路」入口即时出现/消失(镜像 DocsModule 的 listener)。HMR 退订见顶部 _configUnsubs。
    const refreshMenus = (): void => WKApp.menus.refresh?.();
    const rc = WKApp.remoteConfig;
    if (rc) {
      if (rc.requestSuccess) refreshMenus();
      else _configUnsubs.push(rc.addListener(refreshMenus));
      _configUnsubs.push(rc.addConfigChangeListener(refreshMenus));
    }
  }
}
