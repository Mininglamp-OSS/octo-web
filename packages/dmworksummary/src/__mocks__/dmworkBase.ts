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

const titleContexts = new Map<string, { context: any; owner?: symbol }>();
export const titleContextStore = {
  get: (menuId: string) => titleContexts.get(menuId)?.context,
  set: (menuId: string, context: any, owner?: symbol) => {
    titleContexts.set(menuId, { context, owner });
  },
  clear: (menuId: string, owner?: symbol) => {
    const current = titleContexts.get(menuId);
    if (current && (!owner || current.owner === owner))
      titleContexts.delete(menuId);
  },
};

export const WKApp = {
  loginInfo: { token: 'test-token-abc', uid: 'test-uid', isLogined: () => true },
  shared: { currentSpaceId: 'space-123', deviceId: 'test-device-uuid', logout: () => {}, avatarUser: () => '' },
  routeRight: { push: () => {}, replaceToRoot: () => {}, popToRoot: () => {} },
  mittBus: { on: () => {}, off: () => {}, emit: () => {} },
  apiClient: {},
  endpoints: { showConversation: () => {} },
  menus: { menusList: () => [], refresh: () => {} },
};

export default WKApp;

/** Dap 采集单例的测试替身:方法全 no-op,单测可 vi.spyOn(Dap.shared, 'track') 断言埋点调用。 */
export const Dap = {
  shared: {
    track: (_name: string, _props?: Record<string, unknown>) => {},
    pageView: (_pageId: string, _extra?: Record<string, unknown>) => {},
    flush: () => {},
    init: () => {},
    setEnabled: (_v: boolean) => {},
    isEnabled: () => false,
    onDisabled: (_cb: () => void) => {},
    setTokenProvider: (_fn: () => string | undefined) => {},
    getStats: () => ({ enabled: false, queued: 0, dropped: 0 }),
  },
};

export const buildAcceptLanguage = () => 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

export const isSafeUrl = (url: string) => /^https?:\/\//.test(url);

export class SummaryNotifyContent {
  fromUID = '';
  fromName = '';
}

export const isConversationDisbanded = () => false;
