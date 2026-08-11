import React from 'react';
import zhRaw from '../i18n/zh-CN.json';

// Focused mock of the @octo/base seam the meeting module depends on. Only the
// symbols meeting imports are provided; tests mutate WKApp fields to exercise
// header injection, origin derivation and fail-closed branches.

type MessageNode = string | { [key: string]: MessageNode };

function flatten(messages: Record<string, MessageNode>, prefix = ''): Record<string, string> {
  return Object.entries(messages).reduce<Record<string, string>>((acc, [key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      acc[nextKey] = value;
    } else {
      Object.assign(acc, flatten(value, nextKey));
    }
    return acc;
  }, {});
}

// Loaded from the i18n JSON so the mock's `t` resolves real strings.
let zhMessages: Record<string, string> = {};
try {
  zhMessages = Object.entries(flatten(zhRaw as Record<string, MessageNode>)).reduce<Record<string, string>>((acc, [k, v]) => {
    acc[`meeting.${k}`] = v;
    return acc;
  }, {});
} catch {
  zhMessages = {};
}

function interpolate(template: string, values?: Record<string, unknown>) {
  if (!values) return template;
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => String(values[key] ?? ''));
}

export const t = (
  key: string,
  options?: { values?: Record<string, unknown>; defaultValue?: string },
) => interpolate(zhMessages[key] ?? options?.defaultValue ?? key, options?.values);

export const i18n = {
  t,
  getLocale: () => 'zh-CN',
  setLocale: () => {},
  registerNamespace: () => {},
};

export function buildAcceptLanguage(): string {
  return 'zh-CN,zh;q=0.9,en;q=0.8';
}

export interface IModule {
  id(): string;
  init(): void;
}

export class Menus {
  id: string;
  title: string;
  icon: unknown;
  selectedIcon: unknown;
  routePath: string;
  onPress?: () => void;
  badge?: number;
  constructor(
    id: string,
    routePath: string,
    title: string,
    icon: unknown,
    selectedIcon: unknown,
    onPress?: () => void,
  ) {
    this.id = id;
    this.routePath = routePath;
    this.title = title;
    this.icon = icon;
    this.selectedIcon = selectedIcon;
    this.onPress = onPress;
  }
}

// Spy-friendly logout counter used by client tests.
export const __logoutCalls = { count: 0 };
// Registration spies for module gating tests.
export const __registered = { routes: [] as string[], menus: [] as string[] };
export const __routeRightPushes: unknown[] = [];

export const WKApp = {
  loginInfo: { token: 'test-token-abc', uid: 'u-self' } as { token?: string; uid?: string },
  config: { meetingFeatureEnabled: true } as { meetingFeatureEnabled?: boolean },
  shared: {
    currentSpaceId: 'space-123' as string | undefined,
    deviceId: 'device-hash-test',
    logout: () => {
      __logoutCalls.count += 1;
    },
    registerModule: (_m: IModule) => {},
  },
  apiClient: { config: { apiURL: '/api/v1/' } as { apiURL?: string } },
  menus: {
    register: (id: string, _f: () => Menus | undefined, _sort?: number) => {
      __registered.menus.push(id);
    },
    refresh: () => {},
  },
  route: {
    register: (p: string, _h: (param: unknown) => React.ReactNode) => {
      __registered.routes.push(p);
    },
  },
  routeLeft: { push: () => {}, replaceToRoot: () => {}, popToRoot: () => {} },
  routeRight: {
    push: (el: unknown) => {
      __routeRightPushes.push(el);
    },
    replaceToRoot: () => {},
    popToRoot: () => {},
  },
  mittBus: { on: () => {}, off: () => {}, emit: () => {} },
  switchToMenuById: (_id: string) => {},
};

export function __resetWKApp() {
  WKApp.loginInfo = { token: 'test-token-abc', uid: 'u-self' };
  WKApp.shared.currentSpaceId = 'space-123';
  WKApp.apiClient = { config: { apiURL: '/api/v1/' } };
  WKApp.config = { meetingFeatureEnabled: true };
  __logoutCalls.count = 0;
  __registered.routes = [];
  __registered.menus = [];
  __routeRightPushes.length = 0;
}
