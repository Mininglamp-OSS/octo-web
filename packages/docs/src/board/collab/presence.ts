// Whiteboard presence bridge (frontend-design §5 / XIN-16 §7).
//
// Root cause this module closes (XIN-111 / case8 presence_delta=0): the board opened a real
// HocuspocusProvider for content sync (XIN-55), but its presence channel was never wired to that
// provider. `binding.__awareness` (telemetry.ts AwarenessSurface) only ever stored the LOCAL
// peer's state in a field and never touched `provider.awareness` — the y-protocols Awareness the
// provider actually broadcasts over the WS. So A's cursor / online state never reached B and
// B's never reached A: presence_delta stayed 0 even though canvas content (0-7) synced fine.
//
// The doc editor already drives presence straight off `provider.awareness` (PresenceBar reads it,
// CollaborationCaret writes it). This is the board counterpart: write the local peer's user +
// pointer into `provider.awareness`, and read remote peers' states back as the `collaborators`
// Map Excalidraw renders cursors and the online-user list from. Nothing here touches the Y.Doc —
// presence is volatile, never persisted, never content (so the 0-7 content path is untouched).
//
// Kept Excalidraw-free (structural Collaborator shape only) so it stays node-testable with
// y-protocols alone — the same constraint the binding honours.

import type { Awareness } from 'y-protocols/awareness'
import { colorFromId } from '../../awareness/presence.ts'

/** Self-reported local identity for presence (UX only — backend auth is authoritative). */
export interface BoardPresenceUser {
  id: string
  name: string
  avatar?: string
}

/** Live pointer in SCENE coordinates (matches both Excalidraw onPointerUpdate and collaborators). */
export interface BoardPointer {
  x: number
  y: number
}

/**
 * Structural view of an Excalidraw collaborator entry — only the fields the canvas reads to draw a
 * remote cursor and the online-user list. Declared here (not imported from Excalidraw) so this
 * module and its test run under plain node.
 */
export interface BoardCollaborator {
  pointer?: { x: number; y: number }
  button?: 'down' | 'up'
  selectedElementIds?: Record<string, true>
  username?: string
  color?: { background: string; stroke: string }
  id?: string
  avatarUrl?: string
}

/** The per-peer awareness state shape the board publishes/reads. */
interface BoardAwarenessState {
  user?: BoardPresenceUser
  pointer?: BoardPointer | null
  button?: 'down' | 'up'
  selectedElementIds?: string[]
  [k: string]: unknown
}

/** Publish the local peer's identity so remote peers can label and colour its cursor/avatar. */
export function setLocalPresenceUser(awareness: Awareness, user: BoardPresenceUser): void {
  awareness.setLocalStateField('user', { id: user.id, name: user.name, avatar: user.avatar })
}

/**
 * Publish the local peer's live pointer (and optional pressed-button / selection) so remote peers
 * render this cursor. Wire from Excalidraw's `onPointerUpdate`. Pointer is in scene coordinates.
 */
export function publishLocalPointer(
  awareness: Awareness,
  pointer: BoardPointer | null,
  button: 'down' | 'up' = 'up',
  selectedElementIds?: readonly string[],
): void {
  awareness.setLocalStateField('pointer', pointer)
  awareness.setLocalStateField('button', button)
  if (selectedElementIds) {
    awareness.setLocalStateField('selectedElementIds', [...selectedElementIds])
  }
}

/** Drop the local pointer (on blur / unmount) so peers stop drawing a stale cursor for us. */
export function clearLocalPointer(awareness: Awareness): void {
  awareness.setLocalStateField('pointer', null)
}

/**
 * Build the Excalidraw `collaborators` Map from every REMOTE peer's awareness state (the local
 * peer — `awareness.clientID` — is excluded; Excalidraw must not draw a cursor for itself). Keyed
 * by the awareness client id so the map is stable across change events. A peer with neither a
 * resolved user nor a pointer is skipped so a bare connecting socket does not show as a phantom
 * collaborator. presence_delta>0 is exactly: this map is non-empty when a second peer is present.
 */
export function readBoardCollaborators(awareness: Awareness): Map<string, BoardCollaborator> {
  const map = new Map<string, BoardCollaborator>()
  const localId = awareness.clientID
  for (const [clientId, raw] of awareness.getStates()) {
    if (clientId === localId) continue
    const state = raw as BoardAwarenessState
    const user = state.user
    const hasPointer = !!state.pointer && typeof state.pointer.x === 'number'
    if (!user && !hasPointer) continue // empty/connecting peer — nothing to render yet

    const collaborator: BoardCollaborator = {}
    if (hasPointer && state.pointer) {
      collaborator.pointer = { x: state.pointer.x, y: state.pointer.y }
      collaborator.button = state.button === 'down' ? 'down' : 'up'
    }
    if (Array.isArray(state.selectedElementIds)) {
      const selected: Record<string, true> = {}
      for (const id of state.selectedElementIds) selected[id] = true
      collaborator.selectedElementIds = selected
    }
    if (user?.name) collaborator.username = user.name
    if (user?.id) collaborator.id = user.id
    if (user?.avatar) collaborator.avatarUrl = user.avatar
    // Stable colour per identity (same person → same colour), falling back to the client id.
    const seed = user?.id || String(clientId)
    const color = colorFromId(seed)
    collaborator.color = { background: color, stroke: color }
    map.set(String(clientId), collaborator)
  }
  return map
}

/** Count of remote peers currently visible in presence — the `presence_delta` the QA case reads. */
export function presenceDelta(awareness: Awareness): number {
  return readBoardCollaborators(awareness).size
}

/**
 * Relabel each collaborator with the viewer's authoritative uid → display-name directory (the
 * space-member map, same `names.get(uid) || uid` seam MemberPanel and the doc caret use), keyed by
 * the peer's uid. A peer publishes `name: userName || uid` for ITSELF, so a peer whose own member
 * list had not resolved yet (useMemberNames is empty until the fetch lands) broadcasts its raw
 * 32-hex uid, which then surfaced verbatim in the collaborator/cursor label (XIN-680). The viewer's
 * directory is authoritative for names in this space, so prefer it and keep the peer-published
 * username only when the uid is unknown here. Mutates and returns the same map.
 */
export function resolveCollaboratorNames(
  map: Map<string, BoardCollaborator>,
  names: ReadonlyMap<string, string>,
): Map<string, BoardCollaborator> {
  for (const collaborator of map.values()) {
    const resolved = collaborator.id ? names.get(collaborator.id) : undefined
    if (resolved) collaborator.username = resolved
  }
  return map
}
