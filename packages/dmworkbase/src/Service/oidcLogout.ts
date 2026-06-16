export const OIDC_POST_LOGOUT_CLEANUP_KEY = "octo_oidc_post_logout_cleanup";

const AUTH_STORAGE_PREFIXES = [
  "token",
  "uid",
  "short_no",
  "app_id",
  "name",
  "role",
  "is_work",
  "sex",
  "login_provider",
  "realname_verified",
  "real_name",
  "realname_verified_at",
];

const AUTH_STORAGE_KEYS = ["currentSpaceId", "pending_oidc_login"];

export interface OidcLogoutResponse {
  status?: number;
  end_session_url?: unknown;
  [key: string]: unknown;
}

export function isOidcLoginProvider(providerId: unknown): providerId is string {
  return (
    typeof providerId === "string" &&
    providerId !== "" &&
    providerId !== "local"
  );
}

export function buildOidcLogoutPath(providerId: string): string {
  return `/v1/auth/oidc/${encodeURIComponent(providerId)}/logout`;
}

export function safeEndSessionUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return value;
    }
  } catch {
    /* invalid URL */
  }
  return undefined;
}

export function overridePostLogoutRedirectUri(
  endSessionUrl: string,
  redirectUri: unknown
): string {
  const safeRedirectUri = safeEndSessionUrl(redirectUri);
  if (!safeRedirectUri) return endSessionUrl;
  try {
    const parsed = new URL(endSessionUrl);
    parsed.searchParams.set("post_logout_redirect_uri", safeRedirectUri);
    return parsed.toString();
  } catch {
    return endSessionUrl;
  }
}

export async function requestOidcLogout(
  providerId: string,
  token: string,
  fetcher: typeof fetch = fetch
): Promise<OidcLogoutResponse> {
  const resp = await fetcher(buildOidcLogoutPath(providerId), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      token,
    },
  });
  if (!resp.ok) {
    throw new Error(`OIDC logout failed: HTTP ${resp.status}`);
  }
  if (resp.status === 204) return {};
  const text = await resp.text();
  if (!text) return {};
  return JSON.parse(text) as OidcLogoutResponse;
}

export function markOidcPostLogoutCleanup(): boolean {
  try {
    sessionStorage.setItem(OIDC_POST_LOGOUT_CLEANUP_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function consumeOidcPostLogoutCleanup(): boolean {
  try {
    const marked = sessionStorage.getItem(OIDC_POST_LOGOUT_CLEANUP_KEY) === "1";
    if (marked) {
      sessionStorage.removeItem(OIDC_POST_LOGOUT_CLEANUP_KEY);
    }
    return marked;
  } catch {
    return false;
  }
}

function removeMatchingStorage(store: Storage | undefined): void {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key) continue;
      if (
        AUTH_STORAGE_KEYS.includes(key) ||
        AUTH_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      store.removeItem(key);
    }
  } catch {
    /* storage may be unavailable in private mode */
  }
}

export function clearAuthStorage(): void {
  removeMatchingStorage(
    typeof sessionStorage === "undefined" ? undefined : sessionStorage
  );
  removeMatchingStorage(
    typeof localStorage === "undefined" ? undefined : localStorage
  );
}
