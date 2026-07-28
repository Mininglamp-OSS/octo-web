// Mock for @octo/base — minimal WKApp stubs for unit tests.
// The vitest alias (vite.config.ts) points '@octo/base' here so the api layer
// can be tested without the full app runtime.
export const WKApp = {
  loginInfo: { token: 'test-token-abc', uid: 'test-uid', name: 'Tester' },
  shared: {
    currentSpaceId: 'space-123',
    logout: () => {},
    avatarUser: (uid: string) => `/api/v1/users/${uid}/avatar`,
  },
  route: { register: () => {} },
  menus: { register: () => {} },
};

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
