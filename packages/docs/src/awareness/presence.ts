// Awareness / presence helpers (frontend-design §5).
//
// awareness is volatile (not persisted, not in the doc). user.id is self-reported and only
// drives local styling (cursor color/label); the authoritative online identity is the
// backend's per-connection auth identity. Presentation here is UX only, never an auth source.

import type { Awareness } from 'y-protocols/awareness'

export interface OctoAwarenessUser {
  id: string
  name: string
  /** Cursor color; derived from id so the same person is stably colored. */
  color: string
  avatar?: string
}

const PALETTE = [
  '#F5A623', '#7B61FF', '#2D9CDB', '#27AE60', '#EB5757',
  '#BB6BD9', '#F2994A', '#56CCF2', '#6FCF97', '#9B51E0',
]

/** Stable color from a user id (same id -> same color across sessions). */
export function colorFromId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function dedupeById(users: OctoAwarenessUser[]): OctoAwarenessUser[] {
  const seen = new Map<string, OctoAwarenessUser>()
  for (const u of users) {
    if (u && u.id && !seen.has(u.id)) seen.set(u.id, u)
  }
  return [...seen.values()]
}

/** Read the deduped list of online users from an awareness instance. */
export function readOnlineUsers(awareness: Awareness): OctoAwarenessUser[] {
  const states = Array.from(awareness.getStates().values()) as Array<{ user?: OctoAwarenessUser }>
  return dedupeById(
    states
      .map((s) => s.user)
      .filter((u): u is OctoAwarenessUser => Boolean(u && u.id && u.name)),
  )
}
