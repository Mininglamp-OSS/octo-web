import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingMailAuthorizeSearch,
  claimMailAuthorizationRecoveryAttempt,
  clearMailAuthorizationRecoveryAttempt,
  getMailAuthorizationSessionStorage,
  isMailAuthorizationAuthenticationError,
  isMailAuthorizePath,
  MAIL_AUTHORIZATION_RESOLVED_EVENT,
  mailAuthorizeCode,
  mailAuthorizeMailbox,
  mailAuthorizeSpaceId,
  notifyMailAuthorizationResolved,
  resolveMailAuthorizeSearch,
  stripMailAuthorizeCodeFromUrl,
} from "../../../../packages/mail/src/authorizationSession";

describe("Agent Mail authorization deep link", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("accepts the canonical route with or without a trailing slash", () => {
    expect(isMailAuthorizePath("/mail/authorize")).toBe(true);
    expect(isMailAuthorizePath("/mail/authorize/")).toBe(true);
    expect(isMailAuthorizePath("/mail")).toBe(false);
  });

  it("keeps the authorization code across login URL replacement", () => {
    expect(
      resolveMailAuthorizeSearch(
        "/mail/authorize",
        "?code=ABCD-1234",
        sessionStorage
      )
    ).toBe("?code=ABCD-1234");

    const restored = resolveMailAuthorizeSearch(
      "/mail/authorize/",
      "?sid=session-1",
      sessionStorage
    );
    expect(restored).toBe("?code=ABCD-1234");
    expect(mailAuthorizeCode(restored)).toBe("ABCD-1234");
  });

  it("keeps the requested mailbox across login URL replacement", () => {
    resolveMailAuthorizeSearch(
      "/mail/authorize",
      "?code=ABCD-1234&mailbox=alice-bot%40demo.octo.test&space_id=space-1111",
      sessionStorage
    );

    const restored = resolveMailAuthorizeSearch(
      "/mail/authorize/",
      "?sid=session-1",
      sessionStorage
    );
    expect(mailAuthorizeMailbox(restored)).toBe("alice-bot@demo.octo.test");
    expect(mailAuthorizeSpaceId(restored)).toBe("space-1111");
  });

  it("clears the pending code after approval", () => {
    resolveMailAuthorizeSearch(
      "/mail/authorize",
      "?code=ABCD-1234",
      sessionStorage
    );
    clearPendingMailAuthorizeSearch(sessionStorage);

    expect(
      resolveMailAuthorizeSearch(
        "/mail/authorize",
        "?sid=session-2",
        sessionStorage
      )
    ).toBe("?sid=session-2");
  });

  it("keeps the current URL usable when session storage is unavailable", () => {
    expect(
      resolveMailAuthorizeSearch(
        "/mail/authorize",
        "?code=ABCD-1234&space_id=space-1111",
        null
      )
    ).toBe("?code=ABCD-1234&space_id=space-1111");
    expect(() => clearPendingMailAuthorizeSearch(null)).not.toThrow();
  });

  it("handles browsers that throw while reading the session storage property", () => {
    const storage = vi
      .spyOn(window, "sessionStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });

    expect(getMailAuthorizationSessionStorage()).toBeNull();
    storage.mockRestore();
  });

  it("recognizes only an OCTO session code as a login round-trip", () => {
    expect(
      isMailAuthorizationAuthenticationError({
        status: 401,
        code: "err.shared.auth.token_expired",
      })
    ).toBe(true);
    expect(
      isMailAuthorizationAuthenticationError({
        normalized: { code: "err.shared.auth.token_invalid" },
      })
    ).toBe(true);
    expect(isMailAuthorizationAuthenticationError({ status: 401 })).toBe(
      false
    );
    expect(
      isMailAuthorizationAuthenticationError({
        status: 401,
        code: "unauthorized",
      })
    ).toBe(false);
    expect(isMailAuthorizationAuthenticationError({ status: 403 })).toBe(
      false
    );
    expect(isMailAuthorizationAuthenticationError(new Error("offline"))).toBe(
      false
    );
  });

  it("removes the one-time code from history while preserving visible context", () => {
    window.history.replaceState(
      null,
      "",
      "/mail/authorize?code=ABCD-1234&mailbox=bot%40example.com&space_id=space-a#ok"
    );

    stripMailAuthorizeCodeFromUrl();

    expect(window.location.pathname).toBe("/mail/authorize");
    expect(window.location.search).toBe(
      "?mailbox=bot%40example.com&space_id=space-a"
    );
    expect(window.location.hash).toBe("#ok");
  });

  it("allows only one expired-session recovery attempt per code", () => {
    expect(
      claimMailAuthorizationRecoveryAttempt("ABCD-1234", sessionStorage)
    ).toBe(true);
    expect(
      claimMailAuthorizationRecoveryAttempt("ABCD-1234", sessionStorage)
    ).toBe(false);

    clearMailAuthorizationRecoveryAttempt("ABCD-1234", sessionStorage);
    expect(
      claimMailAuthorizationRecoveryAttempt("ABCD-1234", sessionStorage)
    ).toBe(true);
  });

  it("notifies the host when the authorization return target is resolved", () => {
    const listener = vi.fn();
    window.addEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, listener);

    notifyMailAuthorizationResolved();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(MAIL_AUTHORIZATION_RESOLVED_EVENT, listener);
  });
});
