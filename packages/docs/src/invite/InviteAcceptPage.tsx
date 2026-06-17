import { useEffect, useState } from 'react'
import { acceptInvite, type AcceptResult } from './api.ts'
import { safeReturnTo } from './safeReturnTo.ts'
import { t } from '../octoweb/index.ts'

export interface InviteAcceptPageProps {
  token: string
  /** Navigate into the document after a successful accept (then runs §7.3 collab-token flow). */
  onEnterDocument?: (documentName: string) => void
  /** Kick off octo login with a redirect-back target; defaults to a location-based redirect. */
  redirectToLogin?: (returnTo: string) => void
}

function defaultRedirectToLogin(returnTo: string): void {
  if (typeof window !== 'undefined') {
    // returnTo is already guarded by safeReturnTo (internal /docs/ only).
    window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }
}

type View =
  | { kind: 'accepting' }
  | { kind: 'entered'; role: string; documentName: string }
  | { kind: 'invalid' }
  | { kind: 'error' }

/** Invite accept page at route `/docs/invite/:token` (frontend-design §12.3). */
export function InviteAcceptPage({ token, onEnterDocument, redirectToLogin }: InviteAcceptPageProps) {
  const [view, setView] = useState<View>({ kind: 'accepting' })

  useEffect(() => {
    let active = true
    ;(async () => {
      let result: AcceptResult
      try {
        result = await acceptInvite(token)
      } catch {
        if (active) setView({ kind: 'error' })
        return
      }
      if (!active) return
      switch (result.status) {
        case 'entered':
          setView({ kind: 'entered', role: result.role, documentName: result.documentName })
          onEnterDocument?.(result.documentName)
          break
        case 'login-required': {
          // Save current invite path as returnTo (guarded), then login -> redirect-back -> retry.
          const returnTo = safeReturnTo(`/docs/invite/${token}`)
          ;(redirectToLogin ?? defaultRedirectToLogin)(returnTo)
          break
        }
        case 'invalid':
          setView({ kind: 'invalid' })
          break
      }
    })()
    return () => {
      active = false
    }
  }, [token, onEnterDocument, redirectToLogin])

  return (
    <div className="octo-doc octo-theme">
      {view.kind === 'accepting' && <p className="octo-loading">{t('docs.invite.accepting')}</p>}
      {view.kind === 'entered' && (
        <div>
          <h2>{t('docs.invite.joinedTitle')}</h2>
          <p>
            {t('docs.invite.roleLabel')}{' '}
            <strong>{t(`docs.role.${view.role}`, { defaultValue: view.role })}</strong>
          </p>
        </div>
      )}
      {view.kind === 'invalid' && (
        <div>
          <h2>{t('docs.invite.invalidTitle')}</h2>
          <p className="octo-terminal-msg">{t('docs.invite.invalidBody')}</p>
        </div>
      )}
      {view.kind === 'error' && (
        <div>
          <h2>{t('docs.invite.errorTitle')}</h2>
          <p className="octo-terminal-msg">{t('docs.invite.errorBody')}</p>
        </div>
      )}
    </div>
  )
}
