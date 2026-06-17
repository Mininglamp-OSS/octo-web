import StorageService from "./StorageService"

// Cache key for the server-issued numeric device id (clientMsgDeviceId).
// Distinct from "deviceId" which holds the UUID. Backed by sessionStorage
// (per-tab) via StorageService — same scope as the UUID, so each tab's
// (UUID, numeric id) pair stays consistent.
//
// Exported for tests; do NOT use this key directly from production code —
// always go through the helpers below.
export const STORAGE_KEY = "clientMsgDeviceIdNumeric"

/**
 * Read the cached numeric device id from sessionStorage.
 *
 * Returns null when no cache exists, when the stored value is not parseable,
 * or when the parsed value is not a positive finite integer. Returning null
 * (not 0) is important: the SDK default `clientMsgDeviceId === 0` means
 * "no real id" and the caller distinguishes the two states.
 *
 * Issue #256: this read happens BEFORE WKSDK.connect() in App.startMain to
 * eliminate the race window where outbound messages would carry
 * clientMsgNo = <uuid>_0_3 instead of <uuid>_<real-id>_3.
 */
export function loadCachedNumericDeviceId(): number | null {
  const raw = StorageService.shared.getItem(STORAGE_KEY)
  if (raw === null || raw === "") return null
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * Persist the numeric device id to sessionStorage. Silently no-ops on
 * non-positive input (defensive — should never be called with 0; we only
 * cache the real server-issued id) and on storage write failures (Safari
 * private mode, QuotaExceededError). A failed save means next session will
 * fall back to the first-login path — no behavioral regression vs current.
 */
export function saveNumericDeviceId(n: number): void {
  if (!Number.isFinite(n) || n <= 0) return
  try {
    StorageService.shared.setItem(STORAGE_KEY, String(n))
  } catch (e) {
    console.warn("[clientMsgDeviceIdCache] save failed; cache will be repopulated next session:", e)
  }
}

/**
 * Remove the cached numeric device id. Called from clearLocalLoginState
 * during logout so the next user (or relogin) on the same tab always
 * re-traverses the first-login flow (correct numeric id for the new auth).
 */
export function clearCachedNumericDeviceId(): void {
  StorageService.shared.removeItem(STORAGE_KEY)
}
