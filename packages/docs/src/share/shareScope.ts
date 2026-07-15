// Link share scope / role enums (feature #64, frontend-design §2/§3).
//
// The wire values are byte-aligned with the octo-docs-backend handler
// (src/permission/shareScope.ts): scope `restricted` | `anyone_in_space`,
// role `read` | `edit`. The frontend does NO permission judgement — it only
// renders the current setting and passes the chosen values to PUT /share; the
// backend enforces the effective role on every path.

/** Share scope wire enum (matches backend shareScopeName). */
export type ShareScope = 'restricted' | 'anyone_in_space'

/** Share role wire enum (matches backend shareRoleName). */
export type ShareRole = 'read' | 'edit'

/** Selectable order for the scope radios and the role select. */
export const SHARE_SCOPES: readonly ShareScope[] = ['restricted', 'anyone_in_space']
export const SHARE_ROLES: readonly ShareRole[] = ['read', 'edit']

const SCOPE_SET: ReadonlySet<string> = new Set<ShareScope>(SHARE_SCOPES)
const ROLE_SET: ReadonlySet<string> = new Set<ShareRole>(SHARE_ROLES)

export function isShareScope(value: unknown): value is ShareScope {
  return typeof value === 'string' && SCOPE_SET.has(value)
}

export function isShareRole(value: unknown): value is ShareRole {
  return typeof value === 'string' && ROLE_SET.has(value)
}

/**
 * Fail-safe coercion mirroring the backend name mappers: any unexpected value
 * collapses to the MOST RESTRICTIVE interpretation (restricted / read), so a
 * missing or garbled field never widens access in the UI.
 */
export function normalizeShareScope(value: unknown): ShareScope {
  return isShareScope(value) ? value : 'restricted'
}

export function normalizeShareRole(value: unknown): ShareRole {
  return isShareRole(value) ? value : 'read'
}

export interface ShareSettings {
  shareScope: ShareScope
  shareRole: ShareRole
}

/**
 * Loose seed carried in from a getDoc meta, where the additive shareScope/shareRole fields are
 * typed as plain strings (forward-compatible). The panel normalizes these through the fail-safe
 * coercers, so a missing or unexpected value simply falls back to restricted/read.
 */
export interface ShareSeed {
  shareScope?: string
  shareRole?: string
}
