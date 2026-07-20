import React from "react";
import { WKApp, Menus, i18n, t as translate } from "@octo/base";
import type { IModule } from "@octo/base";
import { Cpu } from "lucide-react";
import PersonalPage from "./PersonalPage";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

let _initialized = false;
// remoteConfig 监听退订句柄:HMR 重新 init 时先退订旧的(镜像 DocsModule._configUnsubscribers)。
let _configUnsubs: Array<() => void> = [];
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _configUnsubs.forEach((u) => u());
    _configUnsubs = [];
    _initialized = false;
  });
}

function PersonalIcon({ active }: { active?: boolean }) {
  const color = active ? "var(--wk-brand-primary)" : "currentColor";

  return <Cpu size={22} color={color} strokeWidth={2} />;
}

export default class PersonalModule implements IModule {
  id(): string {
    return "DMPersonalModule";
  }

  init(): void {
    if (_initialized) return;
    _initialized = true;

    i18n.registerNamespace("personal", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    WKApp.route.register("/personal", () => <PersonalPage />);

    // 上线开关:仅当后端 appconfig `dmpersonal_on`(WKApp.remoteConfig.dmpersonalOn)为 true 才展示
    // 「我的 / 运行时」入口,否则返回 undefined 隐藏。与 dmloop_on 独立(「我的」后续脱离 loop 演进)。
    // 默认 false(fail-safe),镜像 DocsModule(docs_on)。纯显示门,/personal 路由仍注册。
    WKApp.menus.register(
      "dmpersonal",
      () =>
        WKApp.remoteConfig?.dmpersonalOn
          ? new Menus(
              "dmpersonal",
              "/personal",
              translate("personal.menu.title"),
              <PersonalIcon />,
              <PersonalIcon active />,
            )
          : undefined,
      4004,
    );

    // appconfig 异步:dmpersonal_on resolve / 切换时刷新 NavRail 让入口即时出现/消失。
    const refreshMenus = (): void => WKApp.menus.refresh?.();
    const rc = WKApp.remoteConfig;
    if (rc) {
      if (rc.requestSuccess) refreshMenus();
      else _configUnsubs.push(rc.addListener(refreshMenus));
      _configUnsubs.push(rc.addConfigChangeListener(refreshMenus));
    }
  }
}
