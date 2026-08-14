export const MAIL_AUTHORIZE_PATH = "/mail/authorize";
export const MAIL_AUTHORIZATION_RESOLVED_EVENT =
  "octo-mail-authorization-resolved";

const PENDING_SEARCH_KEY = "octo.mail.authorize.pending-search";
const RECOVERY_ATTEMPT_KEY = "octo.mail.authorize.recovery-attempt";
const OCTO_SESSION_AUTH_ERROR_CODES = new Set([
  "err.shared.auth.required",
  "err.shared.auth.token_missing",
  "err.shared.auth.token_invalid",
  "err.shared.auth.token_expired",
]);

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getMailAuthorizationSessionStorage(): SessionStorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isMailAuthorizePath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === MAIL_AUTHORIZE_PATH;
}

export function isMailAuthorizationAuthenticationError(
  reason: unknown
): boolean {
  if (!reason || typeof reason !== "object") return false;
  const candidate = reason as {
    code?: unknown;
    normalized?: { code?: unknown };
  };
  const code = String(candidate.code ?? candidate.normalized?.code ?? "");
  return OCTO_SESSION_AUTH_ERROR_CODES.has(code);
}

/**
 * Remove the one-time code from the visible URL after it has been captured in
 * memory/session storage. Other authorization context remains visible so the
 * owner can still inspect the target mailbox and Space.
 */
export function stripMailAuthorizeCodeFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!isMailAuthorizePath(url.pathname) || !url.searchParams.has("code")) {
    return;
  }
  url.searchParams.delete("code");
  const search = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${search ? `?${search}` : ""}${url.hash}`
  );
}

/**
 * Persist the expired-session recovery attempt per one-time code. A failed
 * reload must not repeatedly clear session state forever when the same code is
 * mounted again.
 */
export function claimMailAuthorizationRecoveryAttempt(
  code: string,
  sessionStore: SessionStorageLike | null
): boolean {
  if (!code || !sessionStore) return true;
  try {
    if (sessionStore.getItem(RECOVERY_ATTEMPT_KEY) === code) return false;
    sessionStore.setItem(RECOVERY_ATTEMPT_KEY, code);
    return true;
  } catch {
    return true;
  }
}

export function clearMailAuthorizationRecoveryAttempt(
  code: string,
  sessionStore: SessionStorageLike | null
): void {
  if (!code || !sessionStore) return;
  try {
    if (sessionStore.getItem(RECOVERY_ATTEMPT_KEY) === code) {
      sessionStore.removeItem(RECOVERY_ATTEMPT_KEY);
    }
  } catch {
    // Best-effort cleanup after the authenticated request succeeds.
  }
}

/**
 * Tell the host that this authorization URL no longer needs to survive a
 * login round-trip. The mail package deliberately does not know the host's
 * standalone-return storage key.
 */
export function notifyMailAuthorizationResolved(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MAIL_AUTHORIZATION_RESOLVED_EVENT));
}

/**
 * Preserve the one-time authorization code while the user completes Octo
 * login. The value is session-scoped so another browser session cannot reuse
 * it accidentally, and the backend remains authoritative for expiry and use.
 */
export function resolveMailAuthorizeSearch(
  pathname: string,
  search: string,
  sessionStore: SessionStorageLike | null
): string {
  if (!isMailAuthorizePath(pathname)) return search;
  if (!sessionStore) return search;

  const params = new URLSearchParams(search);
  if (params.get("code")) {
    try {
      sessionStore.setItem(PENDING_SEARCH_KEY, search);
    } catch {
      // Session storage may be unavailable in hardened browser contexts.
    }
    return search;
  }

  try {
    return sessionStore.getItem(PENDING_SEARCH_KEY) || search;
  } catch {
    return search;
  }
}

export function mailAuthorizeCode(search: string): string {
  return new URLSearchParams(search).get("code")?.trim() ?? "";
}

export function mailAuthorizeMailbox(search: string): string {
  return new URLSearchParams(search).get("mailbox")?.trim() ?? "";
}

export function mailAuthorizeSpaceId(search: string): string {
  return new URLSearchParams(search).get("space_id")?.trim() ?? "";
}

export function clearPendingMailAuthorizeSearch(
  sessionStore: SessionStorageLike | null
): void {
  if (!sessionStore) return;
  try {
    sessionStore.removeItem(PENDING_SEARCH_KEY);
  } catch {
    // Best-effort cleanup after the one-time authorization is approved.
  }
}
