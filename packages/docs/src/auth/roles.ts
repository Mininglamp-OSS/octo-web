// Role / capability matrix (frontend-design §7.5).
//
// Permission source is document-autonomous (doc_member + owner) — the frontend NEVER
// derives permissions from documentName or any group. The role is consumed as given by
// the backend: collab-token response role (initial truth) + runtime stateless frames.

export type Role = 'reader' | 'commenter' | 'writer' | 'admin'

const ROLES: ReadonlySet<string> = new Set<Role>(['reader', 'commenter', 'writer', 'admin'])

/** Type guard for a backend-supplied role string. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.has(value)
}

/** writer/admin may edit the body. */
export function canEdit(role: Role): boolean {
  return role === 'writer' || role === 'admin'
}

/** Only admin may manage members / invites / permissions. */
export function canManage(role: Role): boolean {
  return role === 'admin'
}

/**
 * Version history capabilities (frontend-design §6 / feature #4 §6).
 * Capturing a named snapshot + renaming a version is a writer-level edit affordance.
 */
export function canSnapshot(role: Role): boolean {
  return canEdit(role)
}

/**
 * Restoring (and deleting) a historical version is ADMIN/owner ONLY — a writer must
 * NOT be able to roll the authoritative state back (boss decision, feature #4 §6).
 * Mirrors canManage so restore/delete gate identically to member management.
 */
export function canRestoreVersion(role: Role): boolean {
  return canManage(role)
}

/**
 * Commenting is a commenter/writer/admin capability across every document type: a reader may
 * VIEW comments (the list/markers/highlights stay visible) but must never create or reply. This
 * unifies the stricter boundary the HTML surface already enforced locally onto the shared
 * rich-doc / sheet / board surfaces. canEdit ⇒ canComment stays monotone.
 */
export function canComment(role: Role): boolean {
  return role === 'commenter' || role === 'writer' || role === 'admin'
}
