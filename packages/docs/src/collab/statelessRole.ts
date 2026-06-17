// Stateless runtime role-change handling (frontend-design §7.5 / §8.3).
//
// The stateless channel carries ONLY runtime role changes (e.g. online downgrade
// writer->reader, removal). The initial role comes from the collab-token response, not
// from a first stateless frame.
//
// Rules enforced here:
//   - frame `type` literal MUST be 'role-change' (NOT 'permission') — other frames ignored.
//   - role must be a valid enum value.
//   - permission_epoch is applied monotonically: frames with epoch < current are dropped
//     (prevents a stale writer frame arriving late from overwriting a newer reader frame).
//   - a downgrade (role can no longer edit) disposes the cached token so the next reconnect
//     re-issues rather than reusing an unexpired token with the old role/epoch.

import { canEdit, isRole, type Role } from '../auth/roles.ts'
import { disposeToken as defaultDisposeToken } from '../auth/collabToken.ts'

export interface RoleControllerOptions {
  documentName: string
  initialRole: Role
  initialEpoch: number
  /** Called whenever the effective role changes (re-arm editable / banners / manage UI). */
  onRole: (role: Role) => void
  /** Injectable for tests; defaults to the real token disposer. */
  disposeToken?: (documentName: string) => void
}

export class RoleController {
  private role: Role
  private epoch: number
  private readonly documentName: string
  private readonly onRole: (role: Role) => void
  private readonly disposeToken: (documentName: string) => void

  constructor(opts: RoleControllerOptions) {
    this.role = opts.initialRole
    this.epoch = opts.initialEpoch
    this.documentName = opts.documentName
    this.onRole = opts.onRole
    this.disposeToken = opts.disposeToken ?? defaultDisposeToken
  }

  getRole(): Role {
    return this.role
  }

  getEpoch(): number {
    return this.epoch
  }

  /**
   * Handle a raw stateless payload string. Returns true if a role change was applied.
   * Malformed frames keep the current (safe) state and are dropped.
   */
  handleStatelessFrame(payload: string): boolean {
    let msg: { type?: unknown; role?: unknown; permission_epoch?: unknown }
    try {
      msg = JSON.parse(payload)
    } catch {
      return false // malformed frame: keep current state
    }

    if (msg.type !== 'role-change') return false
    if (!isRole(msg.role)) return false

    const epoch = typeof msg.permission_epoch === 'number' ? msg.permission_epoch : 0
    // Monotonic: drop frames not newer than the applied epoch.
    if (epoch < this.epoch) return false

    const nextRole = msg.role
    this.epoch = epoch
    this.role = nextRole

    // Downgrade -> invalidate cached token so reconnect re-issues with current role/epoch.
    if (!canEdit(nextRole)) {
      this.disposeToken(this.documentName)
    }

    this.onRole(nextRole)
    return true
  }
}
