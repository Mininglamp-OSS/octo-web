// "Request access" button on the forbidden landing (feature #511 screen 4c apply).
//
// On click it POSTs an access request; on success (or a 409 "already requested") it collapses to a
// disabled "submitted" state. Idempotency is enforced server-side by (doc_id, requester).
//
// user+Bot grants: the requester's own Bots in this Space are listed DEFAULT-SELECTED and
// individually cancellable. Ownership comes from the owner-scoped `/robot/owned_bots` seam (server
// enforces owner + Space + active) rather than filtering the space-wide catalog client-side. The
// request DEFAULTS to carrying every owned Bot, so an UNKNOWN set (loading, a lookup failure, or a
// shape-degraded 200) must NOT masquerade as zero Bots: the button is disabled while Bots load, a
// failure shows a recoverable error + retry, and only a real zero-Bot success permits a human-only
// request.

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMyOwnedBots, t } from '../octoweb/index.ts'
import { requestAccess, AccessRequestConflictError } from './api.ts'

type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error'
/** Bot-roster fetch lifecycle: without a spaceId there is nothing to load ('ready', zero Bots). */
type BotsState = 'loading' | 'ready' | 'error'

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
      .catch(() => {
        if (generation.current !== gen) return
        // Do NOT silently fall back to human-only: the request defaults to carrying all owned Bots,
        // so an unknown set surfaces a recoverable error the user can retry.
        setBotsState('error')
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

  const onRequest = useCallback(async () => {
    setState('submitting')
    try {
      const botUids = myBots.filter((b) => !cancelled.has(b.uid)).map((b) => b.uid)
      await requestAccess(docId, { spaceId, botUids })
      setState('submitted')
    } catch (e) {
      // A 409 means we already have a pending request — treat as submitted, not an error.
      setState(e instanceof AccessRequestConflictError ? 'submitted' : 'error')
    }
  }, [docId, spaceId, myBots, cancelled])

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
