import { useEffect, useState } from 'react'
import { t } from '../octoweb/index.ts'
import { getShareSettings, setShareSettings } from './api.ts'
import {
  SHARE_ROLES,
  isShareScope,
  normalizeShareRole,
  type ShareRole,
  type ShareScope,
  type ShareSeed,
} from './shareScope.ts'

/**
 * Link share-scope section (feature #64, frontend-design §2). Rendered at the TOP of the
 * admin-only MemberPanel, before "Add member". Lets an admin pick the link share scope
 * (Restricted / Anyone in Space) and, when Anyone in Space, the permission tier (Can read /
 * Can edit). Change-on-select (no save button), mirroring the member role select: the PUT
 * fires immediately, controls are disabled in-flight, and a failure rolls the UI back and
 * surfaces an error. The frontend does NO permission judgement — the backend enforces the
 * effective role on every path.
 *
 * Initial state: prefer the `seed` the caller already has from getDoc (the per-doc GET returns
 * additive shareScope/shareRole, so the doc surface avoids a second request). When no valid seed
 * is supplied (board/sheet surfaces), fetch GET /share on mount. Either way the restricted/read
 * default holds until a value resolves and on read failure.
 *
 * NOTE (octo-web host commit-starvation): this stays inside the already-loaded MemberPanel
 * (editor chunk). It must NOT introduce a React.lazy/Suspense boundary — see module.tsx:79-98.
 */
export function ShareScopePanel({ docId, seed }: { docId: string; seed?: ShareSeed }) {
  // A valid seed scope means the caller (EditorShell) already carried the state in from getDoc —
  // trust it and skip the GET. Otherwise start at the restricted/read default and fetch.
  const seededScope: ShareScope | undefined = isShareScope(seed?.shareScope)
    ? (seed!.shareScope as ShareScope)
    : undefined

  const [scope, setScope] = useState<ShareScope>(seededScope ?? 'restricted')
  const [role, setRole] = useState<ShareRole>(normalizeShareRole(seed?.shareRole))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (seededScope) return
    let cancelled = false
    getShareSettings(docId)
      .then((s) => {
        if (cancelled) return
        setScope(s.shareScope)
        setRole(s.shareRole)
      })
      .catch(() => {
        /* non-fatal: keep the restricted/read default already in state */
      })
    return () => {
      cancelled = true
    }
    // seededScope is derived from the immutable `seed` prop; docId is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function commit(nextScope: ShareScope, nextRole: ShareRole) {
    const prevScope = scope
    const prevRole = role
    setError(null)
    setSaving(true)
    // Optimistic: reflect the choice immediately, roll back to the prior state if the PUT fails.
    setScope(nextScope)
    setRole(nextRole)
    try {
      const saved = await setShareSettings(docId, nextScope, nextRole)
      setScope(saved.shareScope)
      setRole(saved.shareRole)
    } catch {
      setScope(prevScope)
      setRole(prevRole)
      setError(t('docs.share.error'))
    } finally {
      setSaving(false)
    }
  }

  function onScopeChange(next: ShareScope) {
    if (next === scope || saving) return
    // Switching to Anyone in Space keeps the current tier (defaults to Can read on first switch,
    // since role state starts at read); Restricted lets the backend force-persist read.
    void commit(next, next === 'anyone_in_space' ? role : 'read')
  }

  function onRoleChange(next: ShareRole) {
    // The role select only renders under anyone_in_space, so a change always commits that scope.
    if (next === role || saving) return
    void commit('anyone_in_space', next)
  }

  return (
    <div className="octo-member-section">
      <h4 className="octo-member-subtitle">{t('docs.share.title')}</h4>

      <label className="octo-member-row">
        <input
          type="radio"
          name={`octo-share-scope-${docId}`}
          value="restricted"
          checked={scope === 'restricted'}
          disabled={saving}
          onChange={() => onScopeChange('restricted')}
        />
        <span className="octo-uid" style={{ flex: 1 }}>
          {t('docs.share.restricted')}
          <small style={{ color: 'var(--octo-muted)' }}> · {t('docs.share.restrictedHint')}</small>
        </span>
      </label>

      <label className="octo-member-row">
        <input
          type="radio"
          name={`octo-share-scope-${docId}`}
          value="anyone_in_space"
          checked={scope === 'anyone_in_space'}
          disabled={saving}
          onChange={() => onScopeChange('anyone_in_space')}
        />
        <span className="octo-uid" style={{ flex: 1 }}>
          {t('docs.share.anyoneInSpace')}
          <small style={{ color: 'var(--octo-muted)' }}>
            {' '}
            · {t('docs.share.anyoneInSpaceHint')}
          </small>
        </span>
      </label>

      {/* Permission tier: shown + enabled ONLY when scope = Anyone in Space (§2). */}
      {scope === 'anyone_in_space' && (
        <div className="octo-member-row">
          <span className="octo-uid" style={{ flex: 1 }}>
            {t('docs.share.permission')}
          </span>
          <select
            aria-label={t('docs.share.permission')}
            value={role}
            disabled={saving}
            onChange={(e) => onRoleChange(e.target.value as ShareRole)}
          >
            {SHARE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`docs.share.role.${r}`)}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="octo-member-error">{error}</p>}
    </div>
  )
}
