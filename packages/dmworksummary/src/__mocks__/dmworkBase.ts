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
  shared: { currentSpaceId: 'space-123', deviceId: 'test-device-uuid', logout: () => {}, avatarUser: () => '' },
  routeRight: { push: () => {}, replaceToRoot: () => {}, popToRoot: () => {} },
  mittBus: { on: () => {}, off: () => {}, emit: () => {} },
  apiClient: {},
  endpoints: { showConversation: () => {} },
};

export default WKApp;

export const buildAcceptLanguage = () => 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

export const isSafeUrl = (url: string) => /^https?:\/\//.test(url);

// 群内总结 tip 的消息内容体，测试里只需要能 new + set 字段 + encodeJSON。
export class SummaryNotifyContent {
  fromUID = '';
  fromName = '';
  contentObj: Record<string, unknown> = {};
  encodeJSON() {
    return { from_uid: this.fromUID || '', from_name: this.fromName || '' };
  }
}

// 群解散判定：测试默认返回 false（未解散）。需要覆盖解散分支的用例可 vi.mocked 覆盖。
export const isConversationDisbanded = (_channel?: unknown) => false;
