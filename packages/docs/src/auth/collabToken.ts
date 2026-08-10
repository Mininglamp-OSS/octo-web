// Two-layer token chain — collab token issuance + caching (frontend-design §7.3 / §11.2(4)).
//
// The octo session token (opaque, injected by WKApp.apiClient's interceptor) is used ONLY
// to exchange a short-lived collab JWT via POST /api/v1/docs/collab-token. The long-lived
// octo token is never attached to the WS — the function-style provider getter holds the
// collab token.
//
// Cache/in-flight key includes uid, canonical documentName, and issuance endpoint identity:
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
export function tokenCacheKey(uid: string, documentName: string, docId?: string): string {
  return `${uid}::${documentName}::${docId ? `doc:${docId}` : 'legacy'}`
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
  docId?: string,
): Promise<TokenEntry> {
  // docId-first issuance (Phase-1 remove-`sp` design §7.1): when the caller knows the stable docId,
  // the path is the complete locator and the backend derives canonical documentName + home Space from
  // doc_meta. Do not send a redundant client documentName that could be mistaken for authoritative.
  // The legacy endpoint still needs `{ documentName }` during its compatibility window.
  const path = docId ? `/docs/${encodeURIComponent(docId)}/collab-token` : COLLAB_TOKEN_PATH
  const body = docId ? {} : { documentName }
  const config = docId ? { signal, suppressSpaceId: true } : { signal }
  const { data } = await apiClient().post<CollabTokenResponse>(path, body, config)
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
 *
 * The cache identity includes endpoint mode so a legacy token can never satisfy a docId-first
 * request for the same canonical name. `docId`, when supplied, routes issuance to
 * `/docs/:docId/collab-token`; omit it for the legacy documentName-only endpoint.
 */
export async function getCollabTokenEntry(
  documentName: string,
  docId?: string,
): Promise<TokenEntry> {
  const uid = getCurrentUid()
  const key = tokenCacheKey(uid, documentName, docId)

  const hit = tokenCache.get(key)
  if (hit && !isExpiringSoon(hit.expiresAt)) return hit

  let f = inflight.get(key)
  if (!f) {
    const ac = new AbortController()
    let promise: Promise<TokenEntry>
    promise = issueCollabToken(documentName, uid, ac.signal, docId).finally(() => {
      // A disposed request may settle after a replacement issuance has occupied the same key.
      // Only remove our own record; otherwise the stale finally would de-coalesce the replacement.
      if (inflight.get(key)?.promise === promise) inflight.delete(key)
    })
    f = { promise, ac }
    inflight.set(key, f)
  }

  const fresh = await f.promise
  // Some API adapters/mocks do not reject when AbortSignal fires. Disposal is still authoritative:
  // never let such a late response repopulate the slot that was explicitly invalidated.
  if (f.ac.signal.aborted) throw new Error('collab-token issuance was disposed')
  // Re-check uid before writing back: if the account switched while issuance was in flight,
  // dropping the stale token prevents cross-uid pollution of the new session's slot.
  if (getCurrentUid() !== uid) {
    throw new Error('uid changed during token issuance; dropping stale token')
  }
  tokenCache.set(key, fresh)
  return fresh
}

/** Provider token getter form — returns only the token string. */
export async function getCollabToken(documentName: string, docId?: string): Promise<string> {
  return (await getCollabTokenEntry(documentName, docId)).token
}

/**
 * Invalidate a cached token and cancel any in-flight issuance.
 * Called on document destroy, account switch, and on downgrade (so the next reconnect
 * re-issues rather than reusing an unexpired token carrying the old role/epoch — P1-5).
 */
export interface DisposeTokenOptions {
  uid?: string
  /** Must match the issuance mode; docId-first tokens live in a distinct cache slot. */
  docId?: string
}

export function disposeToken(documentName: string, opts: DisposeTokenOptions = {}): void {
  const key = tokenCacheKey(opts.uid ?? getCurrentUid(), documentName, opts.docId)
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
