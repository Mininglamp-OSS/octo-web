import { defaultLocale, Locale, normalizeLocale } from "./types";

export const localeStorageKey = "octo:locale";
export const localeCookieName = "i18n_lang";
const localeCookieMaxAgeSeconds = 60 * 60 * 24 * 365;

function getLocaleFromQueryParam(name: string): Locale | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeLocale(params.get(name));
  } catch (_) {
    return undefined;
  }
}

function getLocaleFromQuery(): Locale | undefined {
  return getLocaleFromQueryParam("lang") || getLocaleFromQueryParam("locale");
}

function getLocaleFromCookie(): Locale | undefined {
  const cookie = typeof document !== "undefined" ? document.cookie : "";
  if (!cookie) return undefined;

  const prefix = `${localeCookieName}=`;
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);

  if (!value) return undefined;

  try {
    return normalizeLocale(decodeURIComponent(value));
  } catch (_) {
    return normalizeLocale(value);
  }
}

function getLocaleFromStorage(): Locale | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return normalizeLocale(window.localStorage.getItem(localeStorageKey));
  } catch (_) {
    return undefined;
  }
}

function getLocaleFromNavigator(): Locale | undefined {
  if (typeof navigator === "undefined") return undefined;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  const firstLanguage = languages.find(Boolean);
  if (!firstLanguage) return undefined;
  return firstLanguage.replace("_", "-").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function detectLocale(explicitLocale?: string | Locale): Locale {
  return (
    normalizeLocale(explicitLocale) ||
    getLocaleFromQuery() ||
    getLocaleFromCookie() ||
    getLocaleFromStorage() ||
    getLocaleFromNavigator() ||
    defaultLocale
  );
}

export function persistLocaleCookie(locale: Locale) {
  if (typeof document === "undefined") return;

  document.cookie = [
    `${localeCookieName}=${encodeURIComponent(locale)}`,
    "Path=/",
    `Max-Age=${localeCookieMaxAgeSeconds}`,
    "SameSite=Lax",
  ].join("; ");
}
