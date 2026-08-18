import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOidcLogoutPath,
  clearAuthStorage,
  createOidcLogoutFetcher,
  consumeOidcPostLogoutCleanup,
  isOidcLoginProvider,
  markOidcPostLogoutCleanup,
  overridePostLogoutRedirectUri,
  performOidcUserInitiatedLogout,
  requestOidcLogout,
  safeEndSessionUrl,
  type OidcUserInitiatedLogoutDeps,
} from "../oidcLogout";

describe("oidcLogout helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("identifies OIDC providers and excludes local or empty providers", () => {
    expect(isOidcLoginProvider("aegis")).toBe(true);
    expect(isOidcLoginProvider("local")).toBe(false);
    expect(isOidcLoginProvider("")).toBe(false);
    expect(isOidcLoginProvider(undefined)).toBe(false);
  });

  it("builds the backend logout path with an encoded provider id", () => {
    expect(buildOidcLogoutPath("aegis")).toBe("/v1/auth/oidc/aegis/logout");
    expect(buildOidcLogoutPath("corp/sso")).toBe(
      "/v1/auth/oidc/corp%2Fsso/logout"
    );
  });

  it("posts the Octo token to backend logout and parses end_session_url", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 200,
            end_session_url:
              "https://accounts.example.com/end_session?id_token_hint=jwt",
          }),
          { status: 200 }
        )
    );

    const resp = await requestOidcLogout(
      "aegis",
      "octo-token",
      fetcher as typeof fetch
    );

    expect(fetcher).toHaveBeenCalledWith("/v1/auth/oidc/aegis/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        token: "octo-token",
      },
    });
    expect(resp.end_session_url).toBe(
      "https://accounts.example.com/end_session?id_token_hint=jwt"
    );
  });

  it("treats a non-JSON success body as an empty logout response", async () => {
    const fetcher = vi.fn(
      async () => new Response("logged out", { status: 200 })
    );
    const resp = await requestOidcLogout(
      "aegis",
      "octo-token",
      fetcher as typeof fetch
    );
    expect(resp).toEqual({});
  });

  it("resolves Electron logout through the absolute API IPC proxy without an origin preflight", async () => {
    // The `oidc-api-origin-start` preflight was removed together with the
    // main-process handler and the preload allowlist entry — main validates
    // the API origin inline on every `oidc-http-request`. Calling the old
    // channel here would silently break user-initiated OIDC logout on
    // packaged desktop; assert it is NOT invoked.
    const invoke = vi.fn(async (channel: string) => {
      if (channel === "oidc-http-request") {
        return {
          __octoOidcHttpResponse: true,
          ok: true,
          status: 200,
          body: { end_session_url: "https://accounts.example.com/end_session" },
        };
      }
      throw new Error(`unexpected channel ${channel}`);
    });
    const fetcher = createOidcLogoutFetcher("https://api.example.com/v1/", { invoke });
    expect(fetcher).toBeDefined();
    await requestOidcLogout("corp/sso", "octo-token", fetcher);
    expect(invoke).not.toHaveBeenCalledWith(
      "oidc-api-origin-start",
      expect.anything()
    );
    expect(invoke).toHaveBeenCalledWith("oidc-http-request", {
      url: "https://api.example.com/v1/auth/oidc/corp%2Fsso/logout",
      method: "POST",
      body: undefined,
      headers: { Accept: "application/json", token: "octo-token" },
    });
  });

  it("resolves Electron logout through typed OIDC bridge methods when available", async () => {
    const httpRequest = vi.fn(async () => ({
      __octoOidcHttpResponse: true,
      ok: true,
      status: 200,
      body: { end_session_url: "https://accounts.example.com/end_session" },
    }));
    const fetcher = createOidcLogoutFetcher("https://api.example.com/v1/", { httpRequest });
    expect(fetcher).toBeDefined();

    await requestOidcLogout("corp/sso", "octo-token", fetcher);

    expect(httpRequest).toHaveBeenCalledWith({
      url: "https://api.example.com/v1/auth/oidc/corp%2Fsso/logout",
      method: "POST",
      body: undefined,
      headers: { Accept: "application/json", token: "octo-token" },
    });
  });

  it("rejects failed backend logout responses", async () => {
    const fetcher = vi.fn(
      async () => new Response("login required", { status: 401 })
    );
    await expect(
      requestOidcLogout("aegis", "bad-token", fetcher as typeof fetch)
    ).rejects.toThrow("OIDC logout failed: HTTP 401");
  });

  it("only accepts absolute https end_session URLs (RFC 8252 §8.10)", () => {
    // Aligned with the main-process validateOpenExternalUrl allowlist so a
    // dev/preprod IdP misconfigured to return http:// fails fast here rather
    // than as an opaque main-process rejection later.
    expect(
      safeEndSessionUrl("https://accounts.example.com/end_session")
    ).toBeTruthy();
    // http is rejected — deliberately stricter than the old behavior.
    expect(safeEndSessionUrl("http://localhost:8080/end_session")).toBeUndefined();
    expect(safeEndSessionUrl("http://idp.internal/end_session")).toBeUndefined();
    expect(safeEndSessionUrl("/end_session")).toBeUndefined();
    expect(safeEndSessionUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeEndSessionUrl("data:text/html,bye")).toBeUndefined();
    expect(safeEndSessionUrl(undefined)).toBeUndefined();
    expect(safeEndSessionUrl("")).toBeUndefined();
    expect(safeEndSessionUrl("https://evil.example.com/")).toBeUndefined();
    expect(safeEndSessionUrl("https://accounts.example.com/authorize")).toBeUndefined();
    expect(safeEndSessionUrl("https://accounts.example.com/end_session?exec=curl")).toBeUndefined();
    expect(safeEndSessionUrl("https://user:pass@accounts.example.com/end_session")).toBeUndefined();
    expect(safeEndSessionUrl("https://accounts.example.com/end_session#/login")).toBeUndefined();
  });

  it("can override post_logout_redirect_uri for local development", () => {
    const rewritten = overridePostLogoutRedirectUri(
      "https://accounts.example.com/end_session?id_token_hint=jwt&post_logout_redirect_uri=https%3A%2F%2Ftest.example.com%2Flogin",
      "https://localhost.example.com/login"
    );

    const parsed = new URL(rewritten);
    expect(parsed.origin).toBe("https://accounts.example.com");
    expect(parsed.searchParams.get("id_token_hint")).toBe("jwt");
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://localhost.example.com/login"
    );
  });

  it("ignores unsafe post_logout_redirect_uri overrides", () => {
    const endSessionUrl =
      "https://accounts.example.com/end_session?id_token_hint=jwt";
    expect(
      overridePostLogoutRedirectUri(endSessionUrl, "javascript:alert(1)")
    ).toBe(endSessionUrl);
    expect(overridePostLogoutRedirectUri(endSessionUrl, "/login")).toBe(
      endSessionUrl
    );
    // http is also refused now that safeEndSessionUrl is https-only.
    expect(
      overridePostLogoutRedirectUri(endSessionUrl, "http://localhost:3000/login")
    ).toBe(endSessionUrl);
  });

  it("marks post-logout cleanup and consumes it once", () => {
    expect(markOidcPostLogoutCleanup()).toBe(true);
    expect(consumeOidcPostLogoutCleanup()).toBe(true);
    expect(consumeOidcPostLogoutCleanup()).toBe(false);
  });

  it("clears auth-related storage in both sessionStorage and localStorage", () => {
    sessionStorage.setItem("tokenabc", "t");
    sessionStorage.setItem("uidabc", "u");
    sessionStorage.setItem("login_providerabc", "aegis");
    sessionStorage.setItem("realname_verifiedabc", "1");
    sessionStorage.setItem("pending_oidc_login", "{}");
    sessionStorage.setItem(
      "octo.mail.authorize.pending-search",
      "?code=owner-a&space_id=space-a"
    );
    sessionStorage.setItem(
      "octo.docs.standaloneReturn",
      "/mail/authorize?code=owner-a&space_id=space-a"
    );
    sessionStorage.setItem("theme-mode", "dark");
    localStorage.setItem("tokenabc", "t");
    localStorage.setItem("currentSpaceId", "s1");
    localStorage.setItem("i18n_lang", "zh-CN");

    clearAuthStorage();

    expect(sessionStorage.getItem("tokenabc")).toBeNull();
    expect(sessionStorage.getItem("uidabc")).toBeNull();
    expect(sessionStorage.getItem("login_providerabc")).toBeNull();
    expect(sessionStorage.getItem("realname_verifiedabc")).toBeNull();
    expect(sessionStorage.getItem("pending_oidc_login")).toBeNull();
    expect(
      sessionStorage.getItem("octo.mail.authorize.pending-search")
    ).toBeNull();
    expect(sessionStorage.getItem("octo.docs.standaloneReturn")).toBeNull();
    expect(localStorage.getItem("tokenabc")).toBeNull();
    expect(localStorage.getItem("currentSpaceId")).toBeNull();
    expect(sessionStorage.getItem("theme-mode")).toBe("dark");
    expect(localStorage.getItem("i18n_lang")).toBe("zh-CN");
  });
});

// -----------------------------------------------------------------------------
// performOidcUserInitiatedLogout — orchestration extracted from WKApp so the
// desktop / web branching, the end-session URL scheme gate, and the
// fallback-to-local-logout path are covered without booting WKApp.
//
// The primary regression these tests guard against (P0 from the review):
// the packaged-desktop path must reload the trusted shell and must not invoke
// an external browser. The backend logout request still uses the desktop IPC
// HTTP bridge, but the IdP end-session URL must never leave the app window.
// -----------------------------------------------------------------------------

type SideEffects = ReturnType<typeof makeSideEffects>;
function makeSideEffects() {
  return {
    clearLocalLoginState: vi.fn(),
    clearElectronAuthSession: vi.fn(),
    reloadShell: vi.fn(),
    navigateExternal: vi.fn(),
    markPostLogoutCleanup: vi.fn(),
    fallbackLogout: vi.fn(),
    logger: { warn: vi.fn() },
  };
}

function buildDeps(
  overrides: Partial<OidcUserInitiatedLogoutDeps>,
  sfx: SideEffects,
): OidcUserInitiatedLogoutDeps {
  return {
    loginProvider: "aegis",
    token: "octo-token",
    apiURL: "https://api.example.com",
    ipc: overrides.ipc,
    env: "web",
    devPostLogoutRedirectUriOverride: undefined,
    clearLocalLoginState: sfx.clearLocalLoginState,
    clearElectronAuthSession: sfx.clearElectronAuthSession,
    reloadShell: sfx.reloadShell,
    navigateExternal: sfx.navigateExternal,
    markPostLogoutCleanup: sfx.markPostLogoutCleanup,
    fallbackLogout: sfx.fallbackLogout,
    logger: sfx.logger,
    ...overrides,
  };
}

describe("performOidcUserInitiatedLogout", () => {
  it("falls back to local logout when the provider is local / empty", async () => {
    const sfx = makeSideEffects();
    const requestLogout = vi.fn();
    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        { loginProvider: "local", token: "t", requestLogout },
        sfx,
      ),
    );
    expect(result).toEqual({ kind: "not-oidc" });
    expect(requestLogout).not.toHaveBeenCalled();
    expect(sfx.fallbackLogout).toHaveBeenCalledTimes(1);
    expect(sfx.clearLocalLoginState).not.toHaveBeenCalled();
  });

  it("falls back to local logout when the OIDC token is empty", async () => {
    const sfx = makeSideEffects();
    const result = await performOidcUserInitiatedLogout(
      buildDeps({ loginProvider: "aegis", token: "" }, sfx),
    );
    expect(result).toEqual({ kind: "not-oidc" });
    expect(sfx.fallbackLogout).toHaveBeenCalledTimes(1);
  });

  it("packaged desktop: stays in the trusted shell after logout", async () => {
    const sfx = makeSideEffects();
    const invoke = vi.fn(async () => ({ ok: true }));
    const requestLogout = vi.fn(async () => ({
      end_session_url: "https://accounts.example.com/end_session?id_token_hint=jwt",
    }));

    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "desktop-shell",
          ipc: { invoke },
          requestLogout,
          // Desktop path builds a fetcher via createFetcher; stub it so the
          // orchestration uses our mock ipc rather than driving the real
          // createOidcLogoutFetcher (which would still be correct, but this
          // isolates the test to the orchestration itself).
          createFetcher: () => async () =>
            new Response(
              JSON.stringify({
                end_session_url:
                  "https://accounts.example.com/end_session?id_token_hint=jwt",
              }),
              { status: 200 },
            ),
        },
        sfx,
      ),
    );

    expect(result.kind).toBe("desktop-idp");
    expect(sfx.clearLocalLoginState).toHaveBeenCalledTimes(1);
    expect(sfx.clearElectronAuthSession).toHaveBeenCalledTimes(1);
    expect(sfx.clearElectronAuthSession.mock.invocationCallOrder[0]).toBeGreaterThan(
      invoke.mock.invocationCallOrder[0],
    );
    expect(invoke).toHaveBeenCalledWith(
      "oidc-open-external",
      "https://accounts.example.com/end_session?id_token_hint=jwt",
    );
    expect(sfx.reloadShell).toHaveBeenCalledTimes(1);
    expect(sfx.navigateExternal).not.toHaveBeenCalled();
    expect(sfx.markPostLogoutCleanup).not.toHaveBeenCalled();
    expect(sfx.fallbackLogout).not.toHaveBeenCalled();
  });

  it("packaged desktop: opens provider logout through typed OIDC bridge", async () => {
    const sfx = makeSideEffects();
    const openExternal = vi.fn(async () => ({ ok: true }));

    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "desktop-shell",
          ipc: { openExternal },
          requestLogout: vi.fn(async () => ({
            end_session_url: "https://accounts.example.com/end_session?id_token_hint=jwt",
          })),
        },
        sfx,
      ),
    );

    expect(result.kind).toBe("desktop-idp");
    expect(openExternal).toHaveBeenCalledWith(
      "https://accounts.example.com/end_session?id_token_hint=jwt",
    );
  });

  it("packaged desktop: uses the hidden logout bridge without opening a browser", async () => {
    const sfx = makeSideEffects();
    const invoke = vi.fn(async () => ({ ok: true }));
    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "desktop-shell",
          ipc: { invoke },
          requestLogout: async () => ({
            end_session_url: "https://accounts.example.com/end_session",
          }),
          createFetcher: () => async () =>
            new Response(
              JSON.stringify({ end_session_url: "https://accounts.example.com/end_session" }),
              { status: 200 },
            ),
        },
        sfx,
      ),
    );

    expect(result).toEqual({
      kind: "desktop-idp",
      url: "https://accounts.example.com/end_session",
    });
    expect(invoke).toHaveBeenCalledWith(
      "oidc-open-external",
      "https://accounts.example.com/end_session",
    );
    expect(sfx.clearLocalLoginState).toHaveBeenCalledTimes(1);
    expect(sfx.clearElectronAuthSession).toHaveBeenCalledTimes(1);
    expect(sfx.reloadShell).toHaveBeenCalledTimes(1);
    expect(sfx.navigateExternal).not.toHaveBeenCalled();
    expect(sfx.fallbackLogout).not.toHaveBeenCalled();
  });

  it("web: navigates the current window to the IdP end-session URL and marks cleanup", async () => {
    const sfx = makeSideEffects();
    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "web",
          requestLogout: async () => ({
            end_session_url: "https://accounts.example.com/end_session?id_token_hint=jwt",
          }),
        },
        sfx,
      ),
    );

    expect(result.kind).toBe("web-redirect");
    expect(sfx.clearLocalLoginState).toHaveBeenCalledTimes(1);
    expect(sfx.markPostLogoutCleanup).toHaveBeenCalledTimes(1);
    expect(sfx.navigateExternal).toHaveBeenCalledWith(
      "https://accounts.example.com/end_session?id_token_hint=jwt",
    );
    expect(sfx.reloadShell).not.toHaveBeenCalled();
    expect(sfx.fallbackLogout).not.toHaveBeenCalled();
  });

  it("web: http end_session_url is rejected by safeEndSessionUrl and falls back locally", async () => {
    const sfx = makeSideEffects();
    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "web",
          requestLogout: async () => ({
            end_session_url: "http://accounts.example.com/end_session",
          }),
        },
        sfx,
      ),
    );

    expect(result).toEqual({ kind: "no-end-session" });
    expect(sfx.clearLocalLoginState).not.toHaveBeenCalled();
    expect(sfx.navigateExternal).not.toHaveBeenCalled();
    expect(sfx.markPostLogoutCleanup).not.toHaveBeenCalled();
    expect(sfx.fallbackLogout).toHaveBeenCalledTimes(1);
  });

  it("backend logout throwing (e.g. network / removed channel) is caught and falls back locally", async () => {
    // This is the exact shape of the P0 regression: if the fetcher throws
    // for any reason (removed channel, dropped connection, 401), the
    // orchestration must fall back to local logout without leaving the app
    // in a half-cleared state.
    const sfx = makeSideEffects();
    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "desktop-shell",
          ipc: { invoke: vi.fn() },
          requestLogout: async () => {
            throw new Error("OIDC API origin registration failed");
          },
          createFetcher: () => async () => {
            throw new Error("OIDC API origin registration failed");
          },
        },
        sfx,
      ),
    );

    expect(result.kind).toBe("logout-error");
    expect(sfx.logger.warn).toHaveBeenCalledWith(
      "OIDC logout failed, falling back to local logout",
      expect.any(Error),
    );
    expect(sfx.fallbackLogout).toHaveBeenCalledTimes(1);
    expect(sfx.clearLocalLoginState).not.toHaveBeenCalled();
    expect(sfx.reloadShell).not.toHaveBeenCalled();
  });

  it("desktop-shell announced but no ipc bridge falls back locally without navigating", async () => {
    // Defensive: if `env` is desktop-shell but `window.ipc` is missing
    // (should not happen in practice — preload always injects it), we must
    // not accidentally set `location.href` to a https URL from a file:// shell.
    const sfx = makeSideEffects();
    const result = await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "desktop-shell",
          ipc: undefined,
          requestLogout: async () => ({
            end_session_url: "https://accounts.example.com/end_session",
          }),
          createFetcher: () => undefined,
        },
        sfx,
      ),
    );

    expect(result.kind).toBe("desktop-local");
    expect(sfx.navigateExternal).not.toHaveBeenCalled();
    expect(sfx.reloadShell).not.toHaveBeenCalled();
    expect(sfx.fallbackLogout).toHaveBeenCalledTimes(1);
  });

  it("applies the dev post_logout_redirect_uri override when provided", async () => {
    const sfx = makeSideEffects();
    await performOidcUserInitiatedLogout(
      buildDeps(
        {
          env: "web",
          devPostLogoutRedirectUriOverride:
            "https://localhost.example.com/login",
          requestLogout: async () => ({
            end_session_url:
              "https://accounts.example.com/end_session?post_logout_redirect_uri=https%3A%2F%2Fprod.example.com%2Flogin",
          }),
        },
        sfx,
      ),
    );

    const target = sfx.navigateExternal.mock.calls[0][0] as string;
    const parsed = new URL(target);
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://localhost.example.com/login",
    );
  });
});

// Regression: the `oidc-api-origin-start` channel name must not survive
// anywhere in this module — the preload allowlist and main handler are
// gone, so a stale reference would silently break packaged-desktop logout.
describe("stale IPC channel guard", () => {
  it("does not reference the removed oidc-api-origin-start channel", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "oidcLogout.ts"),
      "utf8",
    );
    // A comment is fine (we explain why the channel is gone). A string
    // literal or identifier match is the regression signal.
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(withoutComments).not.toMatch(/oidc-api-origin-start/);
  });
});
