// "Request access" button on the forbidden landing (feature #511 screen 4c apply).
//
// A receiver who lands on a doc they cannot open sees this under the forbidden message. On click
// it POSTs an access request; on success (or a 409 "already requested") it collapses to a disabled
// "Request submitted, waiting for the document admin" state so a user cannot spam duplicate
// requests. Idempotency is enforced server-side by (doc_id, requester) — the UI just reflects it.

import { useCallback, useState } from 'react'
import { t } from '../octoweb/index.ts'
import { requestAccess, AccessRequestConflictError } from './api.ts'

type State = 'idle' | 'submitting' | 'submitted' | 'error'

export function RequestAccessButton({ docId, spaceId }: { docId: string; spaceId?: string }) {
  const [state, setState] = useState<State>('idle')

  const onRequest = useCallback(async () => {
    setState('submitting')
    try {
      await requestAccess(docId, { spaceId })
      setState('submitted')
    } catch (e) {
      // A 409 means we already have a pending request — treat as submitted, not an error.
      if (e instanceof AccessRequestConflictError) {
        setState('submitted')
        return
      }
      setState('error')
    }
  }, [docId, spaceId])

  if (state === 'submitted') {
    return <p className="octo-access-request-submitted">{t('docs.forward.accessRequested')}</p>
  }

  return (
    <div className="octo-access-request">
      <p className="octo-access-request-hint">{t('docs.forward.accessHint')}</p>
      <button
        type="button"
        className="octo-tb-btn octo-access-request-btn"
        disabled={state === 'submitting'}
        onClick={() => void onRequest()}
      >
        {state === 'submitting' ? t('docs.forward.requesting') : t('docs.forward.requestAccess')}
      </button>
      {state === 'error' && (
        <p className="octo-member-error" role="alert">
          {t('docs.forward.requestFailed')}
        </p>
      )}
    </div>
  )
}
