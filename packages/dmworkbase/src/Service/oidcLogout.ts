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
  "device_flag",
  "realname_verified",
  "real_name",
  "realname_verified_at",
];

const AUTH_STORAGE_KEYS = [
  "currentSpaceId",
  "pending_oidc_login",
  // One-time standalone authorization targets are owned by the account that
  // opened them and must not be replayed after another account signs in.
  "octo.mail.authorize.pending-search",
  "octo.mail.authorize.recovery-attempt",
  "octo.docs.standaloneReturn",
];
// The main-process `oidc-api-origin-start` preflight was removed in the
// desktop OIDC hardening pass — main now validates the API origin inline on
// every `oidc-http-request` (see main/oidcRedirect.ts::validateOidcHttpRequest),
// and the preload allowlist no longer exposes the origin-registration
// channel. Anything referencing that channel here would silently fail on
// packaged desktop; keep the constant deleted so a stale reference is a
// compile error rather than a runtime warning.
const IPC_OIDC_HTTP_REQUEST = "oidc-http-request";
export const IPC_OIDC_OPEN_EXTERNAL = "oidc-open-external";

export interface DesktopOidcIpc {
  invoke?: (channel: string, request: unknown) => Promise<unknown>;
  httpRequest?: (request: unknown) => Promise<unknown>;
  openExternal?: (url: string) => Promise<unknown>;
}

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

// Renderer-side scheme gate for the IdP end-session URL. Aligned with the
// main-process `validateOpenExternalUrl` allowlist (https only) so a
// dev/preprod IdP that hands back a http:// end-session URL fails fast at
// the renderer boundary instead of surfacing as an opaque
// "OIDC logout browser launch failed" from main. RFC 8252 §8.10 forbids
// plaintext on the end-session leg; an http scheme is IdP misconfiguration.
export function safeEndSessionUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    if (parsed.username !== "" || parsed.password !== "" || parsed.hash !== "")
      return undefined;

    const path = parsed.pathname.replace(/\/$/, "").toLowerCase();
    const pathSegments = path.split("/");
    const lastSegment = pathSegments[pathSegments.length - 1] ?? "";
    if (
      ![
        "end_session",
        "endsession",
        "end-session",
        "logout",
        "signout",
        "sign-out",
      ].includes(lastSegment)
    ) {
      return undefined;
    }

    const allowedQueryKeys = new Set([
      "id_token_hint",
      "logout_hint",
      "client_id",
      "post_logout_redirect_uri",
      "state",
      "ui_locales",
      "redirect_uri",
      "returnTo",
      "return_to",
      "return_url",
      "returnUrl",
    ]);
    let valid = true;
    parsed.searchParams.forEach((_queryValue, key) => {
      if (!allowedQueryKeys.has(key)) valid = false;
    });
    if (!valid) return undefined;

    return parsed.toString();
  } catch {
    /* invalid URL */
  }
  return undefined;
}

export function overridePostLogoutRedirectUri(
  endSessionUrl: string,
  redirectUri: unknown
): string {
  const safeRedirectUri = safePostLogoutRedirectUri(redirectUri);
  if (!safeRedirectUri) return endSessionUrl;
  try {
    const parsed = new URL(endSessionUrl);
    parsed.searchParams.set("post_logout_redirect_uri", safeRedirectUri);
    return parsed.toString();
  } catch {
    return endSessionUrl;
  }
}

function safePostLogoutRedirectUri(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== ""
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
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
  try {
    return JSON.parse(text) as OidcLogoutResponse;
  } catch {
    // A successful logout may return an empty or text body. The optional
    // response payload must not turn that into a local-login failure.
    return {};
  }
}

export function createOidcLogoutFetcher(
  apiURL: string,
  ipc: DesktopOidcIpc | undefined
): typeof fetch | undefined {
  if (
    !/^https?:\/\//i.test(apiURL) ||
    (typeof ipc?.httpRequest !== "function" && typeof ipc?.invoke !== "function")
  )
    return undefined;
  return async (input, init) => {
    // Main-process validates the API origin inline on every IPC round-trip
    // (see main/oidcRedirect.ts::validateOidcHttpRequest); no separate
    // origin-registration preflight is required. Previously this fetcher
    // invoked `oidc-api-origin-start` before every request — that channel
    // was removed from the preload allowlist and the main handler, so
    // calling it here would throw and silently break user-initiated OIDC
    // logout on packaged desktop.
    const path = typeof input === "string" ? input : input.toString();
    const url = new URL(
      path,
      apiURL.endsWith("/") ? apiURL : `${apiURL}/`
    ).toString();
    let body: unknown = undefined;
    if (init?.body != null) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = init.body;
      }
    }
    const request = {
      url,
      method: init?.method || "POST",
      body,
      headers: init?.headers,
    };
    const result =
      typeof ipc.httpRequest === "function"
        ? await ipc.httpRequest(request)
        : await ipc.invoke!(IPC_OIDC_HTTP_REQUEST, request);
    const envelope =
      result &&
      typeof result === "object" &&
      (result as Record<string, unknown>).__octoOidcHttpResponse === true
        ? (result as { ok: boolean; status: number; body?: unknown })
        : undefined;
    return new Response(
      JSON.stringify(envelope ? envelope.body ?? {} : result ?? {}),
      {
        status: envelope?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };
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

// -----------------------------------------------------------------------------
// User-initiated OIDC logout orchestration
// -----------------------------------------------------------------------------
//
// Extracted from WKApp.logoutUserInitiated so the desktop / web branching,
// the end-session URL scheme gate, and the fallback-to-local-logout path can
// be exercised in a jsdom test without instantiating WKApp (which owns IM
// runtime state, semi-ui providers, etc.). The class method is now a thin
// wrapper — see App.tsx::logoutUserInitiated.
//
// Kept in this file (rather than a new module) so all end_session_url policy
// lives next to safeEndSessionUrl / overridePostLogoutRedirectUri and the
// scheme rules cannot drift.

export type OidcLogoutEnv = "desktop-shell" | "web";

export interface OidcUserInitiatedLogoutDeps {
  // Login state the orchestration needs to decide whether to talk to the
  // IdP. Left as plain fields (not a WKApp reference) so the test doesn't
  // depend on the whole singleton.
  loginProvider: unknown;
  token: string;
  // API origin used to build the packaged-desktop IPC fetcher. Empty string
  // is treated as "no API URL configured", matching WKApp.apiClient.config.
  apiURL: string;
  // Packaged desktop preload injects `window.octoElectron.oidc` and keeps
  // `window.ipc.invoke` for compatibility; web renderer has neither.
  ipc: DesktopOidcIpc | undefined;
  // Discriminates the packaged file:// shell from a browser tab. Passed in
  // rather than read from `window.location.protocol` so tests do not have
  // to patch jsdom's location.
  env: OidcLogoutEnv;
  // Dev-only override for the IdP `post_logout_redirect_uri` query param.
  // Undefined outside dev; `overridePostLogoutRedirectUri` refuses unsafe
  // values regardless.
  devPostLogoutRedirectUriOverride: unknown;
  // Side-effects the orchestration performs. Injected so the test asserts
  // the sequence without touching real jsdom navigation.
  clearLocalLoginState: () => void | Promise<void>;
  // Electron provider cookies must remain available while the hidden
  // end-session window is navigating. The wrapper performs this cleanup only
  // after that flow has completed (or the local fallback has taken over).
  clearElectronAuthSession?: () => void | Promise<void>;
  reloadShell: () => void; // window.location.reload()
  navigateExternal: (url: string) => void; // window.location.href = url
  markPostLogoutCleanup: () => void; // markOidcPostLogoutCleanup()
  fallbackLogout: () => void | Promise<void>; // WKApp.logout()
  // Injected for testability. Defaults in the wrapper call site.
  requestLogout?: typeof requestOidcLogout;
  createFetcher?: typeof createOidcLogoutFetcher;
  logger?: { warn: (msg: string, err: unknown) => void };
}

// Discriminated outcome so the caller (and the test) can assert *which*
// branch ran, not just that something happened.
export type OidcUserInitiatedLogoutOutcome =
  | { kind: "not-oidc" } // provider is local / empty / no token
  | { kind: "desktop-idp"; url: string } // IdP end-session completed in the hidden window
  | { kind: "desktop-local"; url: string } // IPC guard rejected or IPC unavailable; local fallback
  | { kind: "web-redirect"; url: string }
  | { kind: "no-end-session" } // IdP returned no end_session_url
  | { kind: "logout-error"; error: unknown };

export async function performOidcUserInitiatedLogout(
  deps: OidcUserInitiatedLogoutDeps
): Promise<OidcUserInitiatedLogoutOutcome> {
  const requestLogout = deps.requestLogout ?? requestOidcLogout;
  const createFetcher = deps.createFetcher ?? createOidcLogoutFetcher;
  const logger = deps.logger ?? {
    warn: (msg, err) => console.warn(msg, err),
  };

  if (!isOidcLoginProvider(deps.loginProvider) || !deps.token) {
    await deps.fallbackLogout();
    return { kind: "not-oidc" };
  }

  try {
    const fetcher =
      deps.env === "desktop-shell"
        ? createFetcher(deps.apiURL || "", deps.ipc)
        : undefined;
    const resp = await requestLogout(
      deps.loginProvider,
      deps.token,
      fetcher || fetch
    );
    const rawEndSessionUrl = safeEndSessionUrl(resp.end_session_url);
    const endSessionUrl =
      rawEndSessionUrl && deps.devPostLogoutRedirectUriOverride !== undefined
        ? overridePostLogoutRedirectUri(
            rawEndSessionUrl,
            deps.devPostLogoutRedirectUriOverride
          )
        : rawEndSessionUrl;

    if (!endSessionUrl) {
      // IdP returned no usable end-session URL. Fall back to local logout so
      // the app is not left mounted in an authenticated state.
      await deps.fallbackLogout();
      return { kind: "no-end-session" };
    }

    await deps.clearLocalLoginState();

    if (deps.env === "desktop-shell") {
      // Keep user-initiated logout inside the desktop app. The main process
      // runs the IdP end-session URL in a hidden window so the IdP session is
      // cleared without showing the browser/Web login page to the user.
      const openExternal =
        typeof deps.ipc?.openExternal === "function"
          ? deps.ipc.openExternal
          : typeof deps.ipc?.invoke === "function"
            ? (url: string) => deps.ipc!.invoke!(IPC_OIDC_OPEN_EXTERNAL, url)
            : undefined;
      if (!openExternal) {
        await deps.fallbackLogout();
        return { kind: "desktop-local", url: endSessionUrl };
      }
      const opened = (await openExternal(endSessionUrl)) as { ok?: boolean } | undefined;
      if (opened?.ok !== true) {
        await deps.fallbackLogout();
        return { kind: "desktop-local", url: endSessionUrl };
      }
      // Do not clear the shell's auth session before IPC_OIDC_OPEN_EXTERNAL:
      // the hidden BrowserWindow uses the same session and needs the IdP
      // cookies to complete provider logout. At this point the main process
      // has finished (or timed out) the end-session navigation.
      await deps.clearElectronAuthSession?.();
      deps.reloadShell();
      return { kind: "desktop-idp", url: endSessionUrl };
    }

    // Web: mark the post-logout cleanup so the next boot re-clears storage
    // once the IdP redirects back, then navigate.
    deps.markPostLogoutCleanup();
    deps.navigateExternal(endSessionUrl);
    return { kind: "web-redirect", url: endSessionUrl };
  } catch (error) {
    logger.warn("OIDC logout failed, falling back to local logout", error);
    await deps.fallbackLogout();
    return { kind: "logout-error", error };
  }
}
