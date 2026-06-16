import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOidcLogoutPath,
  clearAuthStorage,
  consumeOidcPostLogoutCleanup,
  isOidcLoginProvider,
  markOidcPostLogoutCleanup,
  overridePostLogoutRedirectUri,
  requestOidcLogout,
  safeEndSessionUrl,
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

  it("rejects failed backend logout responses", async () => {
    const fetcher = vi.fn(
      async () => new Response("login required", { status: 401 })
    );
    await expect(
      requestOidcLogout("aegis", "bad-token", fetcher as typeof fetch)
    ).rejects.toThrow("OIDC logout failed: HTTP 401");
  });

  it("only accepts absolute http(s) end_session URLs", () => {
    expect(
      safeEndSessionUrl("https://accounts.example.com/end_session")
    ).toBeTruthy();
    expect(safeEndSessionUrl("http://localhost:8080/end_session")).toBeTruthy();
    expect(safeEndSessionUrl("/end_session")).toBeUndefined();
    expect(safeEndSessionUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeEndSessionUrl("data:text/html,bye")).toBeUndefined();
    expect(safeEndSessionUrl(undefined)).toBeUndefined();
  });

  it("can override post_logout_redirect_uri for local development", () => {
    const rewritten = overridePostLogoutRedirectUri(
      "https://accounts.example.com/end_session?id_token_hint=jwt&post_logout_redirect_uri=https%3A%2F%2Ftest.example.com%2Flogin",
      "http://localhost:3000/login"
    );

    const parsed = new URL(rewritten);
    expect(parsed.origin).toBe("https://accounts.example.com");
    expect(parsed.searchParams.get("id_token_hint")).toBe("jwt");
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toBe(
      "http://localhost:3000/login"
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
    expect(localStorage.getItem("tokenabc")).toBeNull();
    expect(localStorage.getItem("currentSpaceId")).toBeNull();
    expect(sessionStorage.getItem("theme-mode")).toBe("dark");
    expect(localStorage.getItem("i18n_lang")).toBe("zh-CN");
  });
});
