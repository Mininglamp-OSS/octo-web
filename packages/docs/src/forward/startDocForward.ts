// "Forward document to chat" entry orchestration (feature #511, §4 / §7 / §8).
//
// Runs on the docs side: computes the grant capability, builds the message title + link, wires the
// grant executor (per-uid loop against the forward-grant endpoint), and opens the host's
// conversation-select via the octoweb bridge. The host does channel→uid expansion, "先授权后发",
// the message send, and the partial-failure Toast (only `@octo/base` imports wukongimjssdk).

import { canManage, type Role } from '../auth/roles.ts'
import { openDocForward, t } from '../octoweb/index.ts'
import { buildDocLink } from './link.ts'
import { grantForwardMany } from './api.ts'

/**
 * Whether the current user may grant access when forwarding (frontend-design §1.2):
 *   canManage(role) === admin, OR the user is the document owner.
 * Owner is checked separately because owner is stored in doc_meta, not as a doc_member role.
 */
export function computeCanGrant(
  role: Role | null,
  currentUid: string,
  ownerId?: string,
): boolean {
  if (role && canManage(role)) return true
  return !!ownerId && !!currentUid && currentUid === ownerId
}

export interface StartDocForwardInput {
  docId: string
  /** Live document title (snapshot at forward time). */
  title: string
  role: Role | null
  currentUid: string
  ownerId?: string
  space?: string
  folder?: string
  /** Resource kind — doc/board/sheet — carried into the DocumentShareCard (defaults to 'doc'). */
  kind?: 'doc' | 'board' | 'sheet'
  /** Owner display name for the card eyebrow (optional). */
  ownerName?: string
  /** Pre-formatted "updated at" string for the card eyebrow (optional). */
  updatedAt?: string
}

/**
 * Kick off the forward flow. Safe to call on any role: a non-admin/owner forwarder simply gets a
 * disabled 授权区 (canGrant=false) and can only send the link. The final grant capability is
 * (re)computed here from the LIVE role (E-16: a demoted admin loses the ability), and the backend
 * double-checks (E-10).
 */
export function startDocForward(input: StartDocForwardInput): void {
  const { docId, title, role, currentUid, ownerId, space, folder, kind, ownerName, updatedAt } = input
  const canGrant = computeCanGrant(role, currentUid, ownerId)
  const link = buildDocLink({ docId, space, folder })
  const safeTitle = title?.trim() || t('docs.state.untitled')

  openDocForward({
    docId,
    title: safeTitle,
    link,
    shareAsCard: true,
    spaceId: space,
    kind: kind ?? 'doc',
    ownerName,
    updatedAt,
    canGrant,
    disabledReason: t('docs.forward.grantDisabledReason'),
    defaultRole: 'reader',
    modalTitle: t('docs.forward.modalTitle'),
    // docs owns /docs/* — grant each uid the host expanded from the selected channels.
    grantAccess: canGrant ? (uids, grantRole) => grantForwardMany(docId, uids, grantRole) : undefined,
  })
}
