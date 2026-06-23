import { useEffect, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { canManage } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import {
  createInvite,
  listInvites,
  revokeInvite,
  buildInviteUrl,
  INVITE_EXPIRY_MIN_DAYS,
  INVITE_EXPIRY_MAX_DAYS,
  INVITE_EXPIRY_DEFAULT_DAYS,
  type Invite,
} from './api.ts'

const ROLES: Role[] = ['reader', 'writer', 'admin']

/** Selectable expiry window (#A6): 1–7 days. */
const EXPIRY_DAYS = Array.from(
  { length: INVITE_EXPIRY_MAX_DAYS - INVITE_EXPIRY_MIN_DAYS + 1 },
  (_, i) => INVITE_EXPIRY_MIN_DAYS + i,
)

/** Human-readable expiry for an existing link: a localized date, or "expired" when past (#A6). */
function expiryText(inv: Invite): string {
  if (!inv.expiresAt) return ''
  const when = new Date(inv.expiresAt)
  if (Number.isNaN(when.getTime())) return ''
  if (when.getTime() <= Date.now()) return t('docs.member.expired')
  return t('docs.member.expires', { values: { date: when.toLocaleDateString() } })
}

/** Admin-only invite link management (frontend-design §12.2; redesigned visuals #A5 + expiry #A6). */
export function InvitePanel({ docId, role }: { docId: string; role: Role }) {
  const [invites, setInvites] = useState<Invite[]>([])
  const [newRole, setNewRole] = useState<Role>('writer')
  const [days, setDays] = useState<number>(INVITE_EXPIRY_DEFAULT_DAYS)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  async function refresh() {
    setInvites(await listInvites(docId))
  }

  useEffect(() => {
    if (canManage(role)) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, role])

  if (!canManage(role)) return null

  async function onGenerate() {
    await createInvite(docId, { role: newRole, expiresInDays: days })
    await refresh()
  }

  async function onRevoke(token: string) {
    await revokeInvite(docId, token)
    await refresh()
  }

  async function onCopy(url: string, token: string) {
    try {
      await navigator.clipboard?.writeText(url)
      setCopiedToken(token)
      setTimeout(() => setCopiedToken((c) => (c === token ? null : c)), 1500)
    } catch {
      /* clipboard unavailable — the readonly field still lets the user copy manually */
    }
  }

  return (
    <div className="octo-invite-panel">
      {/* Create row: role + expiry selectors and a clear primary action. */}
      <div className="octo-invite-create">
        <label className="octo-invite-field">
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`docs.role.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="octo-invite-field">
          <span className="octo-invite-field-label">{t('docs.member.expiryLabel')}</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('docs.member.expiryDays', { values: { n: d } })}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="octo-invite-generate" onClick={onGenerate}>
          {t('docs.member.generate')}
        </button>
      </div>

      {invites.length === 0 ? (
        <p className="octo-invite-empty">{t('docs.member.inviteEmpty')}</p>
      ) : (
        <ul className="octo-invite-list">
          {invites.map((inv) => {
            // Always show the link built from THIS origin (secure/correct), falling back to any
            // url the invite already carries.
            const url = buildInviteUrl(inv.inviteToken) || inv.url || ''
            const expiry = expiryText(inv)
            return (
              <li className="octo-invite-item" key={inv.inviteToken}>
                <div className="octo-invite-item-head">
                  <span className="octo-invite-role">{t(`docs.role.${inv.role}`)}</span>
                  {expiry && <span className="octo-invite-expiry">{expiry}</span>}
                  <span className="octo-invite-item-spacer" />
                  <button
                    type="button"
                    className="octo-tb-btn"
                    onClick={() => onCopy(url, inv.inviteToken)}
                  >
                    {copiedToken === inv.inviteToken ? t('docs.member.copied') : t('docs.member.copy')}
                  </button>
                  <button
                    type="button"
                    className="octo-tb-btn octo-invite-revoke"
                    onClick={() => onRevoke(inv.inviteToken)}
                  >
                    {t('docs.member.revoke')}
                  </button>
                </div>
                <input
                  className="octo-invite-url"
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
