import { detectLocale, localeStorageKey, persistLocaleCookie } from "./detectLocale";
import { getTextDirection } from "./direction";
import { createI18nFormatter, I18nFormatter } from "./format";
import {
  defaultLocale,
  FlatMessages,
  I18nInitOptions,
  I18nListener,
  Locale,
  MessageTree,
  NamespaceResources,
  normalizeLocale,
  supportedLocales,
  TranslateOptions,
} from "./types";

function flattenMessages(messages: MessageTree | FlatMessages, prefix = ""): FlatMessages {
  const result: FlatMessages = {};

  Object.entries(messages).forEach(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[nextKey] = value;
      return;
    }
    if (value && typeof value === "object") {
      Object.assign(result, flattenMessages(value as MessageTree, nextKey));
    }
  });

  return result;
}

function withNamespace(namespace: string, messages: FlatMessages): FlatMessages {
  if (!namespace) return messages;
  const prefix = `${namespace}.`;
  return Object.entries(messages).reduce<FlatMessages>((acc, [key, value]) => {
    acc[key.startsWith(prefix) ? key : `${prefix}${key}`] = value;
    return acc;
  }, {});
}

function interpolate(template: string, values?: TranslateOptions["values"]) {
  if (!values) return template;
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    if (value === undefined || value === null) return "";
    if (value instanceof Date) return value.toISOString();
    return String(value);
  });
}

function createEmptyMessages(): Record<Locale, FlatMessages> {
  return supportedLocales.reduce(
    (acc, locale) => {
      acc[locale] = {};
      return acc;
    },
    {} as Record<Locale, FlatMessages>,
  );
}

function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = getTextDirection(locale);
}

export class I18nService {
  private readonly listeners = new Set<I18nListener>();
  private readonly messages = createEmptyMessages();
  private locale: Locale = detectLocale();

  init(options?: I18nInitOptions) {
    if (options?.resources) {
      Object.entries(options.resources).forEach(([namespace, resources]) => {
        this.registerNamespace(namespace, resources);
      });
    }
    this.locale = detectLocale(options?.locale);
    applyDocumentLocale(this.locale);
    return this;
  }

  registerNamespace(namespace: string, resources: NamespaceResources) {
    Object.entries(resources).forEach(([localeKey, messages]) => {
      const locale = normalizeLocale(localeKey);
      if (!locale || !messages) return;
      Object.assign(
        this.messages[locale],
        withNamespace(namespace, flattenMessages(messages))
      );
    });
  }

  getLocale(): Locale {
    return this.locale;
  }

  get format(): I18nFormatter {
    return createI18nFormatter(this.locale);
  }

  setLocale(localeLike: string | Locale, options?: { notify?: boolean; persist?: boolean }) {
    const nextLocale = normalizeLocale(localeLike);
    if (!nextLocale) return;

    const changed = nextLocale !== this.locale;
    this.locale = nextLocale;
    applyDocumentLocale(nextLocale);

    if (options?.persist !== false && typeof window !== "undefined") {
      try {
        window.localStorage.setItem(localeStorageKey, nextLocale);
      } catch (_) {
        // Persistence is a convenience; locale switching should still work without it.
      }
      persistLocaleCookie(nextLocale);
    }

    if (changed && options?.notify !== false) {
      this.notify();
    }
  }

  subscribe(listener: I18nListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  t(key: string, options?: TranslateOptions): string {
    const locale = options?.locale || this.locale;
    const message =
      this.messages[locale]?.[key] ??
      this.messages[defaultLocale]?.[key] ??
      options?.defaultValue ??
      key;
    return interpolate(message, options?.values);
  }

  private notify() {
    Array.from(this.listeners).forEach((listener) => {
      try {
        listener(this.locale);
      } catch (e) {
        console.warn("[i18n] listener threw", e);
      }
    });
  }
}
