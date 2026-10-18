import { runSessionCleanup } from "@octo/base/src/Service/sessionCleanup";
import { clearSessionsWithToken } from "./recoverSession";

interface ExpiringLogin {
  token?: string;
  logout(): void | Promise<void>;
}

/**
 * Clear token buckets synchronously, finish draft revocation, then reload.
 *
 * `target.location.reload()` is called inside a `finally` block so that any
 * IndexedDB / logout failure can never leave an expired standalone page visible.
 * The cleanup error is logged for observability but does not prevent the reload.
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
  target: Pick<Window, "sessionStorage" | "localStorage"> & { location: Pick<Location, "reload"> }
): Promise<void> {
  const token = login.token || "";
  try {
    const cleanup = runSessionCleanup(() => login.logout(), "[standaloneSessionExpiry]");
    if (token) clearSessionsWithToken(token, target.sessionStorage, target.localStorage);
    await cleanup;
  } catch (error) {
    // Log but do not rethrow — reload must happen regardless of cleanup outcome.
    console.error("[standaloneSessionExpiry] logout cleanup failed, reloading anyway", error);
  } finally {
    target.location.reload();
  }
}
