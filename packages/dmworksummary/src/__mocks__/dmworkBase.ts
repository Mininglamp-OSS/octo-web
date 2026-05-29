import React from 'react';
import zhCN from '../i18n/zh-CN.json';

type MessageNode = string | { [key: string]: MessageNode };

function flattenMessages(messages: Record<string, MessageNode>, prefix = ''): Record<string, string> {
  return Object.entries(messages).reduce<Record<string, string>>((acc, [key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc[nextKey] = value;
      return acc;
    }
    Object.assign(acc, flattenMessages(value, nextKey));
    return acc;
  }, {});
}

const messages = Object.entries(flattenMessages(zhCN as Record<string, MessageNode>)).reduce<Record<string, string>>(
  (acc, [key, value]) => {
    acc[`summary.${key}`] = value;
    return acc;
  },
  {},
);

function interpolate(template: string, values?: Record<string, unknown>) {
  if (!values) return template;
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => String(values[key] ?? ''));
}

export const t = (key: string, options?: { values?: Record<string, unknown>; defaultValue?: string }) => {
  return interpolate(messages[key] ?? options?.defaultValue ?? key, options?.values);
};

export const i18n = {
  t,
  getLocale: () => 'zh-CN',
  setLocale: () => {},
  registerNamespace: () => {},
  format: {
    date: (value: string | number | Date) => String(value),
    dateTime: (value: string | number | Date) => String(value),
    number: (value: number) => String(value),
    time: (value: string | number | Date) => String(value),
    relativeTime: (value: number, unit = 'day') => `${value} ${unit}`,
    currency: (value: number, currency: string) => `${currency} ${value}`,
  },
};

export const I18nContext = React.createContext({
  format: i18n.format,
  locale: 'zh-CN' as const,
  setLocale: () => {},
  t,
});

export const useI18n = () => React.useContext(I18nContext);

export const WKApp = {
  loginInfo: { token: 'test-token-abc', uid: 'test-uid' },
  shared: { currentSpaceId: 'space-123', logout: () => {}, avatarUser: () => '' },
  routeRight: { push: () => {}, replaceToRoot: () => {} },
  mittBus: { on: () => {}, off: () => {}, emit: () => {} },
  apiClient: {},
  endpoints: { showConversation: () => {} },
};

export default WKApp;

export const buildAcceptLanguage = () => 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

export const isSafeUrl = (url: string) => /^https?:\/\//.test(url);
