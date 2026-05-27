import { i18n, t as translate, TranslateOptions } from "@octo/base/src/i18n";
import enUS from "./en-US.json";
import zhCN from "./zh-CN.json";

let registered = false;

export function ensureLoginI18n() {
  if (registered) return;
  registered = true;
  i18n.registerNamespace("login", {
    "zh-CN": zhCN,
    "en-US": enUS,
  });
}

export function loginT(key: string, options?: TranslateOptions): string {
  ensureLoginI18n();
  return translate(key.startsWith("login.") ? key : `login.${key}`, options);
}

const serverErrorMessages = zhCN.serverErrors as Record<string, string>;

export function serverErrorKeyFromMessage(message: string): string | undefined {
  ensureLoginI18n();
  return Object.entries(serverErrorMessages).find(([, value]) => value === message)?.[0];
}
