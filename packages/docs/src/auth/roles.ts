// Role / capability matrix (frontend-design §7.5).
//
// Permission source is document-autonomous (doc_member + owner) — the frontend NEVER
// derives permissions from documentName or any group. The role is consumed as given by
// the backend: collab-token response role (initial truth) + runtime stateless frames.

export type Role = 'reader' | 'writer' | 'admin'

const ROLES: ReadonlySet<string> = new Set<Role>(['reader', 'writer', 'admin'])

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
 * Commenting / replying is open to anyone with access (feature #3 §, boss decision
 * "can see → can comment"). Any valid role qualifies — the parameter exists so callers
 * gate symmetrically with the other capability helpers and so a future tightening has a
 * single seam. Resolve/reopen is writer+ (canEdit); editing a body is author-only and
 * hard-deleting another's comment is admin-only (canManage) — those reuse the helpers above.
 */
export function canComment(role: Role): boolean {
  return isRole(role)
}
