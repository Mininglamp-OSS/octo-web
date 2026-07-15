import { useEffect, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import { getShareSettings, setShareSettings } from './api.ts'
import {
  SHARE_ROLES,
  isShareScope,
  normalizeShareRole,
  type ShareRole,
  type ShareScope,
  type ShareSeed,
  type ShareSettings,
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
/**
 * Load status of the panel's scope. `ready` means an authoritative scope is known (from a valid
 * seed or a successful GET /share); `loading` means we're still resolving it; `error` means the
 * read failed and the CURRENT SCOPE IS UNKNOWN. The error state is deliberately NOT collapsed to a
 * confident "Restricted": on an access-control indicator, conflating "read failed / unknown" with
 * "confirmed restricted" would let an admin believe a doc is locked down when the backend could
 * actually be `anyone_in_space`.
 */
type LoadStatus = 'loading' | 'ready' | 'error'

export function ShareScopePanel({
  docId,
  seed,
  onCommitted,
}: {
  docId: string
  seed?: ShareSeed
  /**
   * Called after a scope change is persisted (PUT succeeds), carrying the authoritative
   * `{ scope, role }` the backend returned. The caller (EditorShell) uses it to refresh the seed
   * it holds so a later reopen of the panel (which unmounts/remounts this component) reflects the
   * committed value instead of the now-stale page-load seed. Without this, a committed scope would
   * silently revert to the pre-edit seed on reopen — a confidently-wrong display on an
   * access-control indicator.
   */
  onCommitted?: (next: ShareSettings) => void
}) {
  // A valid seed scope means the caller (EditorShell) already carried the state in from getDoc —
  // trust it and skip the GET. The seed can also arrive LATER (EditorShell sets it after getDoc
  // resolves), so both values are tracked as effect deps below and adopted whenever they appear.
  const seededScope: ShareScope | undefined = isShareScope(seed?.shareScope)
    ? (seed!.shareScope as ShareScope)
    : undefined
  const seededRole: ShareRole = normalizeShareRole(seed?.shareRole)

  // `null` scope = unknown (no authoritative value yet); it is never rendered as a checked radio,
  // so an unknown/failed read cannot masquerade as a confident "Restricted".
  const [scope, setScope] = useState<ShareScope | null>(seededScope ?? null)
  const [role, setRole] = useState<ShareRole>(seededRole)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>(seededScope ? 'ready' : 'loading')
  // Bumped by the retry affordance to re-run the mount fetch after a read failure.
  const [reloadKey, setReloadKey] = useState(0)

  // Whether an AUTHORITATIVE scope has been locked in — from a seed adopted on/after mount, a
  // successful GET /share, or a successful commit. Once true, a LATER-arriving seed must never
  // overwrite it: EditorShell's one-shot getDoc can resolve with PRE-EDIT meta after the admin has
  // already committed a change, and re-adopting that stale seed would silently revert the panel to
  // a confidently-wrong scope. Seeding at mount counts as authoritative; a read failure does not
  // (so a retry / late seed can still populate an as-yet-unknown panel).
  const authoritativeRef = useRef<boolean>(seededScope != null)

  useEffect(() => {
    // Adopt a seed ONLY while no authoritative value is established yet. This still lets a seed that
    // lands after mount (EditorShell's async getDoc) fill an in-flight/unknown panel, but it never
    // lets a late/stale seed clobber a value the admin already committed or a scope already read.
    if (seededScope && !authoritativeRef.current) {
      authoritativeRef.current = true
      setScope(seededScope)
      setRole(seededRole)
      setStatus('ready')
      return
    }
    // Already resolved authoritatively (commit / earlier fetch / earlier seed): do not re-fetch and
    // do not let a changed seed prop overwrite the live value.
    if (authoritativeRef.current) return
    let cancelled = false
    setStatus('loading')
    setScope(null)
    getShareSettings(docId)
      .then((s) => {
        if (cancelled) return
        authoritativeRef.current = true
        setScope(s.shareScope)
        setRole(s.shareRole)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        // Read failed → the true scope is UNKNOWN. Surface an explicit error/unknown state instead
        // of silently presenting "Restricted" as the confirmed current scope. Not authoritative, so
        // a retry or a late seed can still resolve it.
        setScope(null)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [docId, seededScope, seededRole, reloadKey])

  async function commit(nextScope: ShareScope, nextRole: ShareRole) {
    const prevScope = scope
    const prevRole = role
    const prevStatus = status
    const prevAuthoritative = authoritativeRef.current
    setError(null)
    setSaving(true)
    // Optimistic: reflect the choice immediately, roll back to the prior state if the PUT fails. A
    // successful commit also establishes a known scope, so status settles to `ready`. Mark the value
    // authoritative up front so a late getDoc seed landing mid-PUT cannot clobber the choice.
    authoritativeRef.current = true
    setScope(nextScope)
    setRole(nextRole)
    setStatus('ready')
    try {
      const saved = await setShareSettings(docId, nextScope, nextRole)
      setScope(saved.shareScope)
      setRole(saved.shareRole)
      // Bubble the authoritative committed value up so the caller's seed reflects the latest state;
      // otherwise a reopen (this panel unmounts/remounts) would re-seed from the stale page-load
      // value and display a confidently-wrong scope.
      onCommitted?.({ shareScope: saved.shareScope, shareRole: saved.shareRole })
    } catch {
      authoritativeRef.current = prevAuthoritative
      setScope(prevScope)
      setRole(prevRole)
      setStatus(prevStatus)
      setError(t('docs.share.error'))
    } finally {
      setSaving(false)
    }
  }

  function onScopeChange(next: ShareScope) {
    if (saving) return
    // No value-equality early-return: an explicit selection always commits, so an admin can
    // re-assert a scope even from an unknown/error/stale display (the earlier `next === scope`
    // guard blocked re-asserting "Restricted" when the shown value was stale). Native radios only
    // fire onChange on a genuine change, so this never double-fires on the already-selected value.
    //
    // Switching to Anyone in Space normally keeps the current tier. But `role` is only trustworthy
    // once an AUTHORITATIVE scope has been resolved (seed / successful GET / prior commit). In the
    // error/unknown state (`status==='error'` / `scope===null` → `!authoritativeRef.current`) `role`
    // is still just the mount default ('read'); committing anyone_in_space with it would silently
    // downgrade a real anyone_in_space/edit → read that the admin never chose. So in that state we
    // resolve the true role with a fresh GET /share first and only PUT once it is known — and if the
    // GET also fails we keep the unknown state and do NOT write, so an unconfirmed role never reaches
    // a PUT anyone_in_space. Restricted carries no role (the backend force-persists read), so it is
    // safe to commit directly from any state.
    if (next === 'anyone_in_space' && !authoritativeRef.current) {
      void commitAnyoneAfterFreshRead()
      return
    }
    void commit(next, next === 'anyone_in_space' ? role : 'read')
  }

  // Anyone-in-Space commit from an unknown/error state: fetch the authoritative role first so a
  // stale default 'read' can never silently downgrade a real anyone_in_space/edit. Only PUT once the
  // true role is known; if the fresh read also fails, surface the error and leave the panel unknown
  // (no PUT) rather than writing an unconfirmed role.
  async function commitAnyoneAfterFreshRead() {
    setError(null)
    setSaving(true)
    let fresh: ShareSettings
    try {
      fresh = await getShareSettings(docId)
    } catch {
      // Still unknown → refuse to write anyone_in_space with an unconfirmed role. Keep the
      // error/unknown state so the admin can retry rather than silently persisting a downgrade.
      setScope(null)
      setStatus('error')
      setError(t('docs.share.error'))
      setSaving(false)
      return
    }
    // True role resolved. If the backend is already anyone_in_space its tier is preserved (edit
    // stays edit); if it is restricted the fresh role is read, so the first switch correctly starts
    // at Can read. commit() manages `saving` in its finally, so leave it set through the handoff.
    void commit('anyone_in_space', fresh.shareRole)
  }

  function onRoleChange(next: ShareRole) {
    // The role select only renders under anyone_in_space, so a change always commits that scope.
    if (next === role || saving) return
    void commit('anyone_in_space', next)
  }

  // Disable only while a resolve is genuinely in flight (initial fetch or a PUT). In the error /
  // unknown state the controls stay ENABLED so an admin can explicitly assert a scope (which fires
  // a PUT) rather than being stuck — that also re-asserts "Restricted" from a stale/unknown UI.
  const controlsDisabled = saving || status === 'loading'

  return (
    <div className="octo-member-section">
      <h4 className="octo-member-subtitle">{t('docs.share.title')}</h4>

      {status === 'loading' && (
        <p className="octo-uid" style={{ color: 'var(--octo-muted)' }}>
          {t('docs.share.loading')}
        </p>
      )}

      {status === 'error' && (
        <p className="octo-member-error" role="alert">
          {t('docs.share.loadError')}{' '}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {t('docs.share.retry')}
          </button>
        </p>
      )}

      <label className="octo-member-row">
        <input
          type="radio"
          name={`octo-share-scope-${docId}`}
          value="restricted"
          checked={scope === 'restricted'}
          disabled={controlsDisabled}
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
          disabled={controlsDisabled}
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
            disabled={controlsDisabled}
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
