// "Request access" button on the forbidden landing (feature #511 screen 4c apply).
//
// On click it POSTs an access request; on success (or a 409 "already requested") it collapses to a
// disabled "submitted" state. Idempotency is enforced server-side by (doc_id, requester).
//
// user+Bot grants: the requester's own Bots in this Space are listed DEFAULT-SELECTED and
// individually cancellable. Ownership comes from the owner-scoped `/robot/owned_bots` seam (server
// enforces owner + Space + active) rather than filtering the space-wide catalog client-side.
//
// FAILURE MATRIX for the owned-Bot lookup. The request is (doc_id, requester)-idempotent, so a
// human-only submission cannot be amended later — silently dropping Bots is therefore worse than
// asking. But the forbidden landing exists to give a stranded user ONE way forward, so no state may
// be a dead end. Each row is: Bot list → primary CTA → escape hatch → payload.
//
//   loading                    → —        → disabled          → —            → (none yet)
//   200, N Bots                → N rows   → enabled           → —            → uncancelled Bots
//   200, zero Bots             → —        → enabled           → —            → human-only
//   no spaceId                 → —        → enabled           → —            → human-only
//   401 / 403   (unavailable)  → note     → enabled           → —            → human-only
//   404/408/425/429/5xx/       → error    → disabled          → Retry +      → human-only ONLY via
//   network/malformed 200        (unknown)  (Bots unknown)       "me only"      the explicit hatch
//
// "401/403" means the SEMANTIC status (`error.http_status` in the body), because octo-server's
// legacy-compat facade pins the wire status to 400 — see isBotDimensionUnavailable.
//
// The split that matters: 401/403 is a permanent verdict about the CALLER — the standalone
// `/d/:docId` share surface exists for outsiders, who are not Space members and always get one, so
// for them the Bot dimension is UNAVAILABLE, not unknown, and blocking would remove the pre-feature
// ability to ask for access at all. Every other failure leaves the Bot set genuinely UNKNOWN and may
// succeed on retry, so the default stays fail-closed — but the requester can still opt out of the
// Bot dimension knowingly via "request for me only" instead of being locked out.

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMyOwnedBots, t, type ApiError } from '../octoweb/index.ts'
import { requestAccess, AccessRequestConflictError } from './api.ts'

type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error'
/**
 * Bot-roster fetch lifecycle. Without a spaceId there is nothing to load ('ready', zero Bots).
 * 'unavailable' = this caller may not read the Bot dimension at all (401/403): submitting is allowed.
 * 'error' = the set is genuinely UNKNOWN and retry may succeed: the primary is blocked, and dropping
 * Bots requires the explicit "request for me only" hatch.
 */
type BotsState = 'loading' | 'ready' | 'unavailable' | 'error'

/**
 * ONLY 401/403 are verdicts about the caller (not a Space member / no rights on the route), where
 * retrying can never help. Everything else — including 404 (route not deployed yet), 408, 425 and
 * 429 — is transient or ambiguous, so it must NOT read as "you have no Bots": those keep the Bot set
 * UNKNOWN and route to the retryable error state.
 *
 * CRITICAL: read the SEMANTIC status from the error envelope, not the wire status. octo-server's
 * legacy-compat facade (`ResponseErrorL`) pins the HTTP transport status to 400 for business errors
 * and carries the real code in the body as `error.http_status` (403 for `err.shared.auth.forbidden`).
 * Classifying on `response.status` alone would see 400 for the non-member case and wrongly block the
 * exact requester this branch exists to unblock. The wire status is only the fallback, for endpoints
 * that do return real REST codes (`ResponseErrorLWithStatus`) and for non-enveloped failures.
 */
function isBotDimensionUnavailable(e: unknown): boolean {
  const response = (e as ApiError<{ error?: { http_status?: number } }> | undefined)?.response
  const semantic = response?.data?.error?.http_status
  const status = typeof semantic === 'number' ? semantic : response?.status
  return status === 401 || status === 403
}

interface MyBot {
  uid: string
  name: string
}

/** Identity of the doc surface: the inner component is keyed on it, so a switch remounts. */
const keyOf = (docId: string, spaceId?: string) => `${docId}\0${spaceId ?? ''}`

// Outer wrapper: keying the inner component on the doc surface remounts it on any docId/spaceId
// change. A remount discards all inner state (submit result, Bot roster, in-flight submit), so a
// stale submit for the old doc lands on an unmounted tree and can never leak onto the new doc — no
// key-stamped results, no generation dance in the submit path.
export function RequestAccessButton({ docId, spaceId }: { docId: string; spaceId?: string }) {
  const requestKey = keyOf(docId, spaceId)
  return <RequestAccessButtonInner key={requestKey} docId={docId} spaceId={spaceId} />
}

function RequestAccessButtonInner({ docId, spaceId }: { docId: string; spaceId?: string }) {
  const [state, setState] = useState<SubmitState>('idle')
  // The requester's own Bots in this Space (owner-scoped). Default: all selected.
  const [myBots, setMyBots] = useState<MyBot[]>([])
  const [cancelled, setCancelled] = useState<Set<string>>(() => new Set())
  const [botsState, setBotsState] = useState<BotsState>(spaceId ? 'loading' : 'ready')
  // Monotonic load id: a superseded retry's response is discarded so an old load can't land late.
  const generation = useRef(0)

  const loadBots = useCallback(() => {
    if (!spaceId) {
      // No space → no Bot dimension; a human-only request is the real (not degraded) outcome.
      setMyBots([])
      setCancelled(new Set())
      setBotsState('ready')
      return
    }
    const gen = ++generation.current
    setBotsState('loading')
    setMyBots([])
    setCancelled(new Set())
    void fetchMyOwnedBots(spaceId)
      .then((bots) => {
        if (generation.current !== gen) return
        setMyBots(bots.map((b) => ({ uid: b.uid, name: b.name })))
        setBotsState('ready')
      })
      .catch((e: unknown) => {
        if (generation.current !== gen) return
        // 401/403 → the Bot dimension does not exist for this caller: zero Bots, note, and the
        // human-only request proceeds. Any other failure leaves the set unknown: block the primary
        // and offer Retry plus an explicit human-only hatch, rather than dropping Bots silently.
        setBotsState(isBotDimensionUnavailable(e) ? 'unavailable' : 'error')
      })
  }, [spaceId])

  useEffect(() => {
    loadBots()
    return () => {
      // Invalidate any in-flight load.
      generation.current++
    }
  }, [loadBots])

  const toggleBot = useCallback((uid: string) => {
    setCancelled((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }, [])

  // `withBots: false` is the deliberate human-only escape hatch used when the Bot set is UNKNOWN:
  // the requester accepts losing the Bot dimension rather than being stuck behind a failing lookup.
  const onRequest = useCallback(
    async (withBots = true) => {
      setState('submitting')
      try {
        const botUids = withBots
          ? myBots.filter((b) => !cancelled.has(b.uid)).map((b) => b.uid)
          : []
        await requestAccess(docId, { spaceId, botUids })
        setState('submitted')
      } catch (e) {
        // A 409 means we already have a pending request — treat as submitted, not an error.
        setState(e instanceof AccessRequestConflictError ? 'submitted' : 'error')
      }
    },
    [docId, spaceId, myBots, cancelled],
  )

  if (state === 'submitted') {
    return <p className="octo-access-request-submitted">{t('docs.forward.accessRequested')}</p>
  }

  const selectedBotCount = myBots.filter((b) => !cancelled.has(b.uid)).length
  const botsLoading = botsState === 'loading'
  // Never submit with an unknown Bot set: block while loading and on a lookup failure (retry first).
  const submitDisabled = state === 'submitting' || botsLoading || botsState === 'error'

  return (
    <div className="octo-access-request">
      <p className="octo-access-request-hint">{t('docs.forward.accessHint')}</p>
      {botsLoading && (
        <p className="octo-access-request-bots-label">{t('docs.forward.requestBotsLoading')}</p>
      )}
      {botsState === 'unavailable' && (
        <p className="octo-access-request-bots-label">{t('docs.forward.requestBotsUnavailable')}</p>
      )}
      {botsState === 'error' && (
        <div className="octo-access-request-bots">
          <p className="octo-member-error" role="alert">{t('docs.forward.requestBotsError')}</p>
          <button
            type="button"
            className="octo-tb-btn octo-access-request-retry"
            onClick={loadBots}
          >
            {t('docs.forward.requestBotsRetry')}
          </button>
          {/* Escape hatch: no state may dead-end. Retry hits the same endpoint, so if it keeps
              failing this is the only way forward — and it is explicit, so the requester knowingly
              gives up the Bot dimension instead of having it dropped silently. */}
          <button
            type="button"
            className="octo-tb-btn octo-access-request-self-only"
            disabled={state === 'submitting'}
            onClick={() => void onRequest(false)}
          >
            {t('docs.forward.requestSelfOnly')}
          </button>
        </div>
      )}
      {botsState === 'ready' && myBots.length > 0 && (
        <div className="octo-access-request-bots">
          <p className="octo-access-request-bots-label">
            {t('docs.forward.requestBotsLabel', { values: { count: selectedBotCount } })}
          </p>
          {myBots.map((bot) => (
            <label className="octo-access-request-bot" key={bot.uid}>
              <input
                type="checkbox"
                checked={!cancelled.has(bot.uid)}
                onChange={() => toggleBot(bot.uid)}
              />
              <span>{bot.name}</span>
            </label>
          ))}
        </div>
      )}
      <button
        type="button"
        className="octo-tb-btn octo-access-request-btn"
        disabled={submitDisabled}
        onClick={() => void onRequest()}
      >
        {state === 'submitting'
          ? t('docs.forward.requesting')
          : botsLoading
            ? t('docs.forward.requestBotsLoading')
            : t('docs.forward.requestAccess')}
      </button>
      {state === 'error' && (
        <p className="octo-member-error" role="alert">
          {t('docs.forward.requestFailed')}
        </p>
      )}
    </div>
  )
}
