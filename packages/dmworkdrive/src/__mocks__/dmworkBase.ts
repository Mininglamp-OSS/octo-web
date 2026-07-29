// Mock for @octo/base — minimal WKApp stubs for unit tests.
// The vitest alias (vite.config.ts) points '@octo/base' here so the api layer
// can be tested without the full app runtime.

/** Minimal mittBus (mitt-like) so modules can subscribe to `space-changed`. */
function makeMittBus() {
  const map = new Map<string, Set<(payload?: unknown) => void>>();
  return {
    on(event: string, fn: (payload?: unknown) => void) {
      (map.get(event) ?? map.set(event, new Set()).get(event)!).add(fn);
    },
    off(event: string, fn: (payload?: unknown) => void) {
      map.get(event)?.delete(fn);
    },
    emit(event: string, payload?: unknown) {
      map.get(event)?.forEach((fn) => fn(payload));
    },
  };
}

export const WKApp = {
  loginInfo: { token: 'test-token-abc', uid: 'test-uid', name: 'Tester' },
  shared: {
    currentSpaceId: 'space-123',
    logout: () => {},
    avatarUser: (uid: string) => `/api/v1/users/${uid}/avatar`,
  },
  mittBus: makeMittBus(),
  route: { register: () => {} },
  menus: { register: () => {} },
};

/** Minimal ProviderListener base (real one lives in @octo/base) for VM tests. */
export class ProviderListener {
  private _listeners = new Set<() => void>();
  addListener(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  notifyListener(): void {
    this._listeners.forEach((fn) => fn());
  }
}

export const buildAcceptLanguage = () => 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

export const buildDocLink = ({ docId }: { docId: string; space?: string }) =>
  `https://test.local/d/${encodeURIComponent(docId)}`;

export const t = (key: string) => key;
export const useI18n = () => ({ t: (key: string) => key });

export class Menus {
  constructor(
    public id: string,
    public path: string,
    public title: string,
    public icon: unknown,
    public activeIcon?: unknown,
  ) {}
}

export const i18n = {
  registerNamespace: () => {},
};
