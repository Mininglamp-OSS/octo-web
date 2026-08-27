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
  // remoteConfig 的最小测试替身：与真实 App.tsx 的 addConfigChangeListener(cb) => () => void 同形；
  // __fireConfigChangeListeners() 模拟 appconfig 到位 / docs_on 翻转时的广播（round-4 P2-a）。
  remoteConfig: {
    addConfigChangeListener: (cb: () => void): (() => void) => {
      __configChangeListeners.add(cb);
      return () => { __configChangeListeners.delete(cb); };
    },
  },
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

export class SummaryTipContent {
  fromUID = '';
  fromName = '';
  setSender(uid: string, name: string) {
    this.fromUID = typeof uid === 'string' ? uid.trim() : '';
    this.fromName = typeof name === 'string' ? name.trim() : '';
    return this;
  }
  encodeJSON() {
    return {
      content: '{0}总结了群聊内容',
      extra: [{ uid: this.fromUID, name: this.fromName }],
    };
  }
  get contentType() {
    return 2000;
  }
}

export const isConversationDisbanded = () => false;

/**
 * APIClient.extractErrorMsg 的测试替身。真实实现从 axios error 的
 * response.data.msg / message 里挑出可展示的文案，取不到时回退空串。
 */
export const extractErrorMsg = (err: unknown): string => {
  const e = err as { response?: { data?: { msg?: string; message?: string } }; message?: string };
  return e?.response?.data?.msg ?? e?.response?.data?.message ?? e?.message ?? '';
};

/** Utils/docLink.buildDocLink 的测试替身：与真实实现同形，emit `/d/:docId`。 */
export const buildDocLink = ({ docId }: { docId: string }): string =>
  `${typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''}/d/${encodeURIComponent(docId)}`;

/** Utils/clipboard.copyToClipboard 的测试替身，默认成功；单测可 vi.spyOn 覆写。 */
export const copyToClipboard = async (_text: string): Promise<boolean> => true;

// ─── docs 能力端口（bridge/docs/docsPort）的测试替身 ───────────────────
// 真实实现走 EndpointManager；测试里用可写的 registry，单测通过
// __setDocsConvertHandler / __setDocsOn 控制端口是否可用。
let __docsConvertHandler: ((p: { title: string; markdown: string }) => Promise<{ docId: string; url: string }>) | null = null;
let __docsOn = false;

export const __setDocsConvertHandler = (h: typeof __docsConvertHandler) => { __docsConvertHandler = h; };
export const __setDocsOn = (v: boolean) => { __docsOn = v; };
export const __resetDocsPort = () => {
  __docsConvertHandler = null;
  __docsOn = false;
  __configChangeListeners.clear();
};

const __configChangeListeners = new Set<() => void>();
/** 模拟 App.tsx 在 docs_on 等配置变化时的 notifyConfigChangeListeners() 广播。 */
export const __fireConfigChangeListeners = () => {
  for (const cb of [...__configChangeListeners]) cb();
};

export class DocsCapabilityUnavailableError extends Error {
  constructor(message = 'docs capability unavailable') {
    super(message);
    this.name = 'DocsCapabilityUnavailableError';
  }
}

export const isDocsConvertAvailable = (): boolean => __docsOn && !!__docsConvertHandler;

export const convertMarkdownToDoc = async (params: { title: string; markdown: string }) => {
  if (!isDocsConvertAvailable()) throw new DocsCapabilityUnavailableError();
  return __docsConvertHandler!(params);
};
