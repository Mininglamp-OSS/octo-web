// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { localeCookieName, localeStorageKey } from "../detectLocale";
import { I18nService } from "../I18nService";

function createService() {
  return new I18nService().init({
    locale: "zh-CN",
    resources: {
      demo: {
        "zh-CN": {
          fallbackOnly: "默认文案",
          greeting: "你好，{{name}}",
        },
        "en-US": {
          greeting: "Hello, {{name}}",
        },
      },
    },
  });
}

describe("I18nService", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.cookie = `${localeCookieName}=; Path=/; Max-Age=0; SameSite=Lax`;
  });

  it("translates registered namespace keys and interpolates values", () => {
    const service = createService();

    expect(service.t("demo.greeting", { values: { name: "Octo" } })).toBe("你好，Octo");

    service.setLocale("en-US", { persist: false });

    expect(service.t("demo.greeting", { values: { name: "Octo" } })).toBe("Hello, Octo");
  });

  it("falls back to the default locale and then to the key", () => {
    const service = createService();

    service.setLocale("en-US", { persist: false });

    expect(service.t("demo.fallbackOnly")).toBe("默认文案");
    expect(service.t("demo.missing")).toBe("demo.missing");
    expect(service.t("demo.missing", { defaultValue: "Fallback" })).toBe("Fallback");
  });

  it("updates document locale and notifies subscribers on locale changes", () => {
    const service = createService();
    const listener = vi.fn();

    service.subscribe(listener);
    service.setLocale("en-US", { persist: false });

    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dir).toBe("ltr");
    expect(listener).toHaveBeenCalledWith("en-US");
  });

  it("persists locale to localStorage and i18n_lang cookie", () => {
    const service = createService();

    service.setLocale("en-US");

    expect(window.localStorage.getItem(localeStorageKey)).toBe("en-US");
    expect(document.cookie).toContain(`${localeCookieName}=en-US`);
  });

  it("skips storage and cookie persistence when persist is false", () => {
    const service = createService();

    service.setLocale("en-US", { persist: false });

    expect(window.localStorage.getItem(localeStorageKey)).toBeNull();
    expect(document.cookie).not.toContain(localeCookieName);
  });

  it("formats custom date-time options without mixing Intl style shortcuts", () => {
    const service = createService();

    service.setLocale("en-US", { persist: false });

    expect(() =>
      service.format.dateTime("2026-05-10T06:30:00Z", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "2-digit",
        second: "2-digit",
        year: "numeric",
      }),
    ).not.toThrow();
  });
});
