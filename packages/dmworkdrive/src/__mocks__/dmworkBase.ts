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

/** Mirrors @octo/base APIClient.DEFAULT_REQUEST_TIMEOUT_MS (20s) so driveApi's
 *  isolated-axios timeout hardening is exercised under test. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export const buildDocLink = ({ docId, space }: { docId: string; space?: string }) => {
  const sp = (space || '').trim();
  const query = sp ? `?sp=${encodeURIComponent(sp)}` : '';
  return `https://test.local/d/${encodeURIComponent(docId)}${query}`;
};

export const t = (key: string) => key;
export const useI18n = () => ({ t: (key: string) => key });

// Drive-transfer helpers (real ones live in `@octo/base` `Service/SpacePrefix.ts`);
// duplicated here as identical minimal impls so vitest can resolve the aliased
// `@octo/base` import without pulling the full app runtime. Kept in lock-step
// with the real impl via the dmworkdrive unit tests that assert the returned
// values directly (#1261 review round 7 P0-3).
export const hasSpacePrefix = (id: string) => /^s[0-9a-f]{32}_/.test(id);
export const stripSpacePrefix = (id: string) =>
  hasSpacePrefix(id) ? id.substring(id.indexOf('_') + 1) : id;
export const isDriveTransferSupportedChannel = (t: number) =>
  t === 1 || t === 2 || t === 5;

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
