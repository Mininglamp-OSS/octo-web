// Two-layer token chain — collab token issuance + caching (frontend-design §7.3 / §11.2(4)).
//
// The octo session token (opaque, injected by WKApp.apiClient's interceptor) is used ONLY
// to exchange a short-lived collab JWT via POST /api/v1/docs/collab-token. The long-lived
// octo token is never attached to the WS — the function-style provider getter holds the
// collab token.
//
// Cache/in-flight key is `${uid}::${documentName}` (NOT documentName alone): keying by
// documentName only would let a previous uid's token pollute a new session's slot after an
// account switch (P1-6). Concurrent issuance is coalesced via an in-flight promise; the
// AbortController cancels in-flight issuance on dispose; on resolve we re-check uid and drop
// a stale token if the account changed mid-issuance.

import { apiClient, getCurrentUid } from '../octoweb/index.ts'
import { COLLAB_TOKEN_PATH, TOKEN_REFRESH_LEEWAY_MS } from '../config.ts'
import { isRole, type Role } from './roles.ts'

export interface TokenEntry {
  token: string
  /** Absolute expiry in epoch ms. */
  expiresAt: number
  role: Role
  permission_epoch: number
  uid: string
  /**
   * Absolute Hocuspocus WebSocket URL handed down by the backend (XIN-211 contract):
   * `wss://` in production / `ws://` in dev, always an independent origin (never relative).
   * Omitted by the backend when unconfigured — undefined here means "fall back to the legacy
   * build-time env" (see resolveCollabWsUrl in config.ts).
   */
  collabWsUrl?: string
}

/** Raw backend response shape for POST /docs/collab-token (backend §4.4). */
interface CollabTokenResponse {
  token: string
  expiresAt: string | number
  role: string
  permission_epoch: number
  /** Absolute WS URL; the key is absent (not empty) when the backend has no WS configured. */
  collabWsUrl?: string
}

const tokenCache = new Map<string, TokenEntry>()
const inflight = new Map<string, { promise: Promise<TokenEntry>; ac: AbortController }>()

// Named distinctly from the IndexedDB cacheKey (§6) to avoid shadowing.
export function tokenCacheKey(uid: string, documentName: string): string {
  return `${uid}::${documentName}`
}

function isExpiringSoon(expiresAt: number): boolean {
  return expiresAt - Date.now() <= TOKEN_REFRESH_LEEWAY_MS
}

function toEpochMs(value: string | number): number {
  if (typeof value === 'number') return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

async function issueCollabToken(
  documentName: string,
  uid: string,
  signal: AbortSignal,
): Promise<TokenEntry> {
  // Bare-relative -> /api/v1/docs/collab-token. The interceptor injects the octo `token` header.
  const { data } = await apiClient().post<CollabTokenResponse>(
    COLLAB_TOKEN_PATH,
    { documentName },
    { signal },
  )
  if (!isRole(data.role)) {
    throw new Error(`collab-token returned an invalid role: ${String(data.role)}`)
  }
  return {
    token: data.token,
    expiresAt: toEpochMs(data.expiresAt),
    role: data.role,
    permission_epoch: data.permission_epoch ?? 0,
    uid,
    // Present only when the backend configured an absolute WS origin; left undefined otherwise
    // so the consumer falls back to the legacy build-time env (compat window).
    collabWsUrl: data.collabWsUrl,
  }
}

/**
 * Return a fresh collab token entry, coalescing concurrent issuance and isolating by uid.
 * Used both by the provider token getter and to set the initial editable state before connect.
 */
export async function getCollabTokenEntry(documentName: string): Promise<TokenEntry> {
  const uid = getCurrentUid()
  const key = tokenCacheKey(uid, documentName)

  const hit = tokenCache.get(key)
  if (hit && !isExpiringSoon(hit.expiresAt)) return hit

  let f = inflight.get(key)
  if (!f) {
    const ac = new AbortController()
    const promise = issueCollabToken(documentName, uid, ac.signal).finally(() => {
      inflight.delete(key)
    })
    f = { promise, ac }
    inflight.set(key, f)
  }

  const fresh = await f.promise
  // Re-check uid before writing back: if the account switched while issuance was in flight,
  // dropping the stale token prevents cross-uid pollution of the new session's slot.
  if (getCurrentUid() !== uid) {
    throw new Error('uid changed during token issuance; dropping stale token')
  }
  tokenCache.set(key, fresh)
  return fresh
}

/** Provider token getter form — returns only the token string. */
export async function getCollabToken(documentName: string): Promise<string> {
  return (await getCollabTokenEntry(documentName)).token
}

/**
 * Invalidate a cached token and cancel any in-flight issuance.
 * Called on document destroy, account switch, and on downgrade (so the next reconnect
 * re-issues rather than reusing an unexpired token carrying the old role/epoch — P1-5).
 */
export function disposeToken(documentName: string, uid: string = getCurrentUid()): void {
  const key = tokenCacheKey(uid, documentName)
  tokenCache.delete(key)
  const f = inflight.get(key)
  if (f) {
    f.ac.abort()
    inflight.delete(key)
  }
}

/** Test-only: clear all cached/in-flight tokens. */
export function __resetTokenCacheForTests(): void {
  for (const f of inflight.values()) f.ac.abort()
  tokenCache.clear()
  inflight.clear()
}
