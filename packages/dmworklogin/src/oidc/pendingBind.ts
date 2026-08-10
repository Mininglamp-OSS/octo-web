// Marker written by startOidcLogin() before navigating to the IdP, read by
// the packaged-Electron deep-link handler to reject `dmwork://oidc/bind`
// callbacks that were not initiated locally.
//
// Registering `dmwork://` as an OS-level protocol handler (electron-builder.js
// mac.protocols / win.protocols / linux mimeType) makes the bind route
// reachable from ANY web origin: any page can execute
// `location = 'dmwork://oidc/bind?token=ATTACKER_TOKEN'`. Without a
// correlation check, the bind page then loads with an attacker-supplied
// token and — after the victim clears a password/OTP challenge — binds the
// attacker's external identity to the victim's account.
//
// Persisted to localStorage rather than sessionStorage because a real
// external-browser SSO round trip can outlive the packaged app process.
// TTL is short (matches OIDC_AUTHCODE_TTL_MS) and the marker is cleared on
// bind success / failure / login success, so this is not a lasting grant.

const STORAGE_KEY = 'pending_oidc_bind'

// Reuse the same TTL as the authcode / login-pending window. See
// packages/dmworklogin/src/oidc/types.ts.
import { OIDC_AUTHCODE_TTL_MS } from './types'

export interface PendingOidcBind {
  providerId: string
  authcode?: string
  savedAt: number
}

function isPendingOidcBind(value: unknown): value is PendingOidcBind {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.providerId === 'string' &&
    v.providerId !== '' &&
    (v.authcode === undefined || (typeof v.authcode === 'string' && v.authcode !== '')) &&
    typeof v.savedAt === 'number' &&
    Number.isFinite(v.savedAt)
  )
}

export function savePendingOidcBind(value: PendingOidcBind): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage disabled (private mode, quota exceeded): leave the deep-link
    // path closed for this client — a legitimate flow still works via the
    // in-window will-redirect intercept.
  }
}

export function getPendingOidcBind(): PendingOidcBind | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return isPendingOidcBind(parsed) ? parsed : null
}

export function clearPendingOidcBind(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}

export function isPendingBindExpired(
  pending: PendingOidcBind,
  now: number = Date.now(),
): boolean {
  return now - pending.savedAt >= OIDC_AUTHCODE_TTL_MS
}

/**
 * Return true iff a valid unexpired bind marker is present. Convenience
 * wrapper used by the deep-link handler; also clears expired markers so
 * they don't linger past the OIDC TTL.
 */
export function hasValidPendingBind(now: number = Date.now()): boolean {
  const pending = getPendingOidcBind()
  if (!pending) return false
  if (isPendingBindExpired(pending, now)) {
    clearPendingOidcBind()
    return false
  }
  return true
}

/** Consume the marker only for the exact flow started by this client. */
export function consumePendingBindIfMatches(
  expected: { providerId?: string; authcode?: string },
  now: number = Date.now(),
): boolean {
  const pending = getPendingOidcBind()
  if (!pending) return false
  if (isPendingBindExpired(pending, now)) {
    clearPendingOidcBind()
    return false
  }
  const hasProvider = typeof expected.providerId === 'string' && expected.providerId !== ''
  const hasAuthcode = typeof expected.authcode === 'string' && expected.authcode !== ''
  if (!hasProvider || !hasAuthcode) return false
  if (expected.providerId !== pending.providerId) return false
  if (expected.authcode !== pending.authcode) return false
  clearPendingOidcBind()
  return true
}
