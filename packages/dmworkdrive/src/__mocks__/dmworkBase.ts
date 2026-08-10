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

export const buildDocLink = ({ docId }: { docId: string; space?: string; folder?: string }) => {
  // Phase-1 remove-`sp`: ordinary doc links carry only the docId path (space is accepted-but-ignored,
  // mirroring the real @octo/base buildDocLink).
  return `https://test.local/d/${encodeURIComponent(docId)}`;
};

export const t = (key: string) => key;
export const useI18n = () => ({ t: (key: string) => key });

// Mirror @octo/base's real copyToClipboard: prefer navigator.clipboard,
// then fall back to a textarea + execCommand copy. Test-only shim,
// small enough that a full port is easier than pulling the real one.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
  }
}

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

// Mirror the real @octo/base helpers for the drive-transfer source_key.
// Kept in sync with `packages/dmworkbase/src/Service/SpacePrefix.ts` — the
// tests in driveApi.test.ts pin the format, so if the real helper drifts
// these mocks must move too (that is exactly the drift-catching property
// the parity test exists for).
export const normaliseImDriveChannelID = (channelType: number, channelID: string): string => {
  if (channelType !== 1) return channelID;
  if (!hasSpacePrefix(channelID)) return channelID;
  const bare = stripSpacePrefix(channelID);
  return bare === '' ? channelID : bare;
};
export const imDriveTransferSourceKey = (
  channelType: number,
  channelID: string,
  msgID: string,
): string => `${channelType}#${normaliseImDriveChannelID(channelType, channelID)}#${msgID}`;

// Mirror @octo/base's resolveCardActionChannelId — person DM self-collapse
// fallback to fromUID. Kept trivial and value-equivalent so any test that
// asserts on the source_key wire format still exercises the same branch.
export const resolveCardActionChannelId = (params: {
  channelType: number;
  channelID: string;
  fromUID?: string;
  selfUID?: string;
}): string => {
  const { channelType, channelID, fromUID, selfUID } = params;
  if (channelType === 1 && !!selfUID && channelID === selfUID && !!fromUID) {
    return fromUID;
  }
  return channelID;
};

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
