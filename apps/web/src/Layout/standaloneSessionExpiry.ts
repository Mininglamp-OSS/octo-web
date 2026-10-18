import { runSessionCleanup } from "@octo/base/src/Service/sessionCleanup";
import { clearSessionsWithToken } from "./recoverSession";

interface ExpiringLogin {
  token?: string;
  logout(): void | Promise<void>;
}

/**
 * Clear token buckets synchronously, finish draft revocation, then reload.
 *
 * Ordinary cleanup failures can reload behind the durable draft fence. If both
 * the fence and deletion fail, exit to a blank document so stale drafts cannot
 * be reopened by an automatic reload.
 *
 * Why clearing by token VALUE, not just `logout()`:
 * `logout()` clears only the CURRENT `?sid=` bucket, but on a clean cold-load
 * (no `?sid=`) the expired token was recovered from a `token{sid'}` bucket and
 * mirrored into the empty-sid bucket, so it lives in two places.  Clearing every
 * bucket that holds this exact token (clearSessionsWithToken over both storages)
 * tears down all copies, so the reload's recovery can't re-adopt it and loop.
 * A DIFFERENT valid session has a different token and is left untouched
 * (XIN-390/392: 只清当前过期 session，别误清有效 session).
 */
export async function expireStandaloneSession(
  login: ExpiringLogin,
  target: Pick<Window, "sessionStorage" | "localStorage"> & { location: Pick<Location, "reload" | "replace"> }
): Promise<void> {
  const token = login.token || "";
  const cleanup = runSessionCleanup(() => login.logout(), "[standaloneSessionExpiry]");
  try {
    if (token) clearSessionsWithToken(token, target.sessionStorage, target.localStorage);
  } catch (error) {
    console.error("[standaloneSessionExpiry] token cleanup failed", error);
  }
  try {
    await cleanup;
  } catch {
    // runSessionCleanup already logged the mandatory deletion failure.
    target.location.replace("about:blank");
    return;
  }
  target.location.reload();
}
