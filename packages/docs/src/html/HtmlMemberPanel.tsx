import { useCallback, useEffect, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { canManage } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { MemberPicker } from '../members/MemberPicker.tsx'
import { useMemberNames } from '../members/useMemberNames.ts'
import { listGrants, addGrant, removeGrant, type HtmlGrant } from './htmlGrantsApi.ts'
import { ShareScopePanel } from '../share/ShareScopePanel.tsx'
import { InvitePanel } from '../invite/InvitePanel.tsx'
import { useAccessRequests } from '../access-request/useAccessRequests.ts'
import { PendingRequests } from '../access-request/PendingRequests.tsx'

// Member panel for HTML docs. Two backends live behind one modal:
//   1. Legacy octo-doc grants (author-only) — the existing "reader" member list, kept intact so
//      the current author-managed grant flow keeps working while the docs-backend hop is on trial.
//   2. docs-backend (OCT-195) — link share scope, invite links, and pending access requests. These
//      three sections reuse the rich-doc components verbatim; only the option surface is narrowed
//      via allowedRoles so html can never publish writer/admin.
//
// The two gates are intentionally different:
//   - Author gate (isAuthor) governs the octo-doc grant section — it stays byte-compatible with
//     the pre-OCT-195 behavior. octo-doc author is not always the docs-backend admin.
//   - Backend role gate (canManage(role)) governs Share/Invite/Requests — role comes from
//     docs-backend resolveRole via HtmlDocView, single source of truth for that surface.
// A reader that is also octo-doc author still sees the grant list (backwards compatible); an
// admin that is not octo-doc author still sees Share/Invite/Requests.

export function HtmlMemberPanel({
  slug,
  space,
  creatorUid,
  canManage: canManageGrants,
  onClose,
  docId,
  role,
  isAuthor,
}: {
  slug: string
  /** Space id for the member picker roster. */
  space?: string
  /** The doc creator (author). Shown as a locked owner row; never removable. */
  creatorUid?: string
  /** Kept for backward compatibility: octo-doc author flag (window.__ODOC_CAP__.isAuthor).
   *  When both this and `isAuthor` are supplied they mean the same thing; the new prop is preferred
   *  and this one is treated as a fallback so no existing call site breaks during the OCT-195 rollout. */
  canManage?: boolean
  onClose?: () => void
  /** docs-backend doc id (not slug). Required for /docs/{docId}/share|invites|access-requests. */
  docId: string
  /** Backend-resolved role from HtmlDocView.getDoc → resolveRole. Null while resolving; three
   *  Share/Invite/Requests sections stay in a loading placeholder until it settles. Fail-soft:
   *  a 403/404 leaves role=null and the sections stay hidden (never crash). */
  role: Role | null
  /** octo-doc author flag from HtmlDocView (parseOdocCap). Same authority as the legacy
   *  canManage prop; passing both is redundant but harmless. */
  isAuthor: boolean
}) {
  // uid → display name for member rows (falls back to uid until the roster resolves).
  const names = useMemberNames(space ?? '')
  const [grants, setGrants] = useState<HtmlGrant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  // Grant management is octo-doc-author-only. Prefer the new explicit isAuthor prop; keep the
  // legacy canManage prop as a fallback so an older call site that only sets that one still works.
  const canManageAuthorGrants = isAuthor || canManageGrants === true
  // Share / Invite / Requests use the backend role — admin only. `null` role (still resolving or a
  // fail-soft miss) collapses to false: the sections render a loading placeholder rather than a
  // half-baked admin UI, and never crash.
  const canManageBackend = role != null && canManage(role)

  const refresh = useCallback(async () => {
    if (!canManageAuthorGrants) return
    setLoading(true)
    try {
      setGrants(await listGrants(slug))
    } catch {
      setError(t('docs.member.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [slug, canManageAuthorGrants])

  useEffect(() => {
    if (canManageAuthorGrants) void refresh()
  }, [canManageAuthorGrants, refresh])

  // Access-request hook: enabled only when the backend says we can manage; a non-admin never hits
  // the pending endpoint (it would 403).
  const accessRequests = useAccessRequests(docId, canManageBackend)

  // reader is the only grantable role today; MemberPicker returns a Role but we
  // pin it to reader before calling the backend.
  async function onAdd(uids: string[]) {
    setError(null)
    setBusy(true)
    try {
      for (const uid of uids) await addGrant(slug, uid.trim(), 'reader')
      await refresh()
    } catch {
      setError(t('docs.member.errorAdd'))
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(uid: string) {
    setError(null)
    try {
      await removeGrant(slug, uid)
      await refresh()
    } catch {
      setError(t('docs.member.errorRemove'))
    }
  }

  // Existing uids (for the picker's "already added" pins): every granted uid plus
  // the creator. The creator is never a candidate (hidden) and never removable.
  const existingUids = new Set<string>(grants.map((g) => g.uid))
  if (creatorUid) existingUids.add(creatorUid)

  const rows: HtmlGrant[] = []
  if (creatorUid) rows.push({ uid: creatorUid, role: 'author', source: 'owner' })
  for (const g of grants) {
    if (g.source !== 'owner' && g.uid !== creatorUid) rows.push(g)
  }

  // Nothing to render at all when neither gate lets the viewer manage anything AND the backend
  // has already resolved (role != null); a viewer with no capability sees the modal only on the
  // affordance the parent still opens. When role is still resolving we render the shell so the
  // Share/Invite/Requests placeholders can show a loading state.
  if (!canManageAuthorGrants && !canManageBackend && role != null) return null

  return (
    <section className="octo-member-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.member.manage')}</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.member.close')}
          </button>
        )}
      </div>

      {/* Section order mirrors rich-doc MemberPanel (OCT-195):
          Slot 1 ShareScope → Slot 2 Add member → Slot 3 Invite → Slot 4 PendingRequests → Slot 5 Current Members.
          The two independent gates (canManageBackend / canManageAuthorGrants) stay layered — empty
          slots collapse to null, so an author-only or admin-only viewer sees a subset in the same
          order. */}

      {/* Slot 1: ShareScope (backend gate). Loading placeholder here represents the whole backend
          group's pending state — Slots 3/4 share the same `role` and stay hidden until it resolves,
          so a single loading line here is enough (no duplicate placeholders below). */}
      {role == null ? (
        <p className="octo-loading">{t('docs.member.loading')}</p>
      ) : canManageBackend ? (
        <ShareScopePanel docId={docId} allowedRoles={['read']} />
      ) : null}

      {/* Slot 2: Add member (author gate). Independent of backend role — an octo-doc author
          without docs-backend admin still manages reader grants. */}
      {canManageAuthorGrants && (
        <div className="octo-member-section">
          <h4 className="octo-member-subtitle">{t('docs.member.addMember')}</h4>
          <MemberPicker
            space={space}
            existingUids={existingUids}
            hideUids={new Set([creatorUid].filter(Boolean) as string[])}
            roles={['reader']}
            onAdd={(uids: string[], _role: Role) => onAdd(uids)}
            busy={busy}
          />
          {error && <p className="octo-member-error">{error}</p>}
        </div>
      )}

      {/* Slot 3: Invite (backend gate). No local loading — Slot 1 already carries it. */}
      {role != null && canManageBackend && (
        <div className="octo-member-section">
          <h4 className="octo-member-subtitle">{t('docs.member.inviteTitle')}</h4>
          <InvitePanel docId={docId} role={role} allowedRoles={['reader']} />
        </div>
      )}

      {/* Slot 4: Pending access requests (backend gate). No heading of its own. */}
      {role != null && canManageBackend && (
        <PendingRequests
          requests={accessRequests.requests}
          loading={accessRequests.loading}
          error={accessRequests.error}
          approve={accessRequests.approve}
          deny={accessRequests.deny}
          displayName={(uid) => names.get(uid) || uid}
          allowedRoles={['reader']}
        />
      )}

      {/* Slot 5: Current Members (author gate). */}
      {canManageAuthorGrants && (
        <div className="octo-member-section">
          <h4 className="octo-member-subtitle">{t('docs.member.currentMembers')}</h4>
          {loading && <p className="octo-loading">{t('docs.member.loading')}</p>}
          {!loading && rows.length === 0 && (
            <p className="octo-member-empty">{t('docs.member.empty')}</p>
          )}
          {rows.map((m) => {
            const isOwner = m.source === 'owner'
            return (
              <div className="octo-member-row" key={m.uid}>
                <span className="octo-uid">
                  {names.get(m.uid) || m.uid}{' '}
                  {isOwner && <span className="octo-owner-badge">{t('docs.member.ownerBadge')}</span>}
                  {!isOwner && <small style={{ color: 'var(--octo-muted)' }}> · {t('docs.role.reader')}</small>}
                </span>
                {!isOwner && (
                  <button
                    type="button"
                    className="octo-tb-btn"
                    onClick={() => onRemove(m.uid)}
                  >
                    {t('docs.member.remove')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
