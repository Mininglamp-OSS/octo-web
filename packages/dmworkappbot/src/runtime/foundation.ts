import { i18n } from "@octo/base";
import enUS from "../i18n/en-US.json";
import zhCN from "../i18n/zh-CN.json";

export function registerAppBotFoundation(): void {
  i18n.registerNamespace("appbot", {
    "zh-CN": zhCN,
    "en-US": enUS,
  });
}
