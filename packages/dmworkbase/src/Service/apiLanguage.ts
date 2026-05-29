import { i18n } from "../i18n/instance";
import { Locale } from "../i18n/types";

export function buildAcceptLanguage(locale: Locale = i18n.getLocale()): string {
  if (locale === "zh-CN") {
    return "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7";
  }
  return "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7";
}
