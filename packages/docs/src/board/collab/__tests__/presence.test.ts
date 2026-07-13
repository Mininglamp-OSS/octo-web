// XIN-111 — presence cross-peer sync (case8 presence_delta=0 fix).
//
// Proves the bridge that closes the defect: two peers' presence published into their own
// `provider.awareness` reaches the other peer (here we sync the two Awareness instances the way
// HocuspocusProvider syncs them over the WS — encodeAwarenessUpdate → applyAwarenessUpdate), and
// each side reads the other as a renderable Excalidraw collaborator. Before the fix presence was a
// local-only stub (telemetry.ts AwarenessSurface) that never touched provider.awareness, so this
// delta was always 0. The browser/visual smoke is a tester job; this is the logic-layer proof.

import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import {
  setLocalPresenceUser,
  publishLocalPointer,
  clearLocalPointer,
  readBoardCollaborators,
  presenceDelta,
  resolveCollaboratorNames,
  type BoardCollaborator,
} from '../presence.ts'

/** Mirror the provider's awareness fan-out: push `from`'s full state into `to`. */
function sync(from: Awareness, to: Awareness): void {
  const update = encodeAwarenessUpdate(from, Array.from(from.getStates().keys()))
  applyAwarenessUpdate(to, update, 'remote')
}

describe('board presence cross-peer sync (XIN-111 / case8)', () => {
  it('A and B each see the other as a collaborator with cursor + identity (presence_delta>0)', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = new Awareness(docA)
    const b = new Awareness(docB)

    // Both peers publish identity + a live pointer (what BoardShell does on mount + onPointerUpdate).
    setLocalPresenceUser(a, { id: 'wbtest_a', name: 'Alice' })
    publishLocalPointer(a, { x: 120, y: 80 }, 'down', ['el-1'])
    setLocalPresenceUser(b, { id: 'wbtest_b', name: 'Bob' })
    publishLocalPointer(b, { x: 300, y: 220 }, 'up')

    // Before any cross-peer fan-out, neither side sees the other.
    expect(presenceDelta(a)).toBe(0)
    expect(presenceDelta(b)).toBe(0)

    // The provider broadcasts each peer's awareness to the other.
    sync(a, b)
    sync(b, a)

    // presence_delta>0 on both sides — the case8 fix.
    expect(presenceDelta(a)).toBe(1)
    expect(presenceDelta(b)).toBe(1)

    // A sees B's cursor, name and a stable colour; never itself.
    const aSees = readBoardCollaborators(a)
    expect(aSees.has(String(a.clientID))).toBe(false)
    const bAsSeenByA = aSees.get(String(b.clientID))
    expect(bAsSeenByA?.pointer).toEqual({ x: 300, y: 220 })
    expect(bAsSeenByA?.username).toBe('Bob')
    expect(bAsSeenByA?.color?.background).toMatch(/^#[0-9A-F]{6}$/i)

    // B sees A's cursor, pressed button and selection.
    const aAsSeenByB = readBoardCollaborators(b).get(String(a.clientID))
    expect(aAsSeenByB?.pointer).toEqual({ x: 120, y: 80 })
    expect(aAsSeenByB?.button).toBe('down')
    expect(aAsSeenByB?.selectedElementIds).toEqual({ 'el-1': true })
  })

  it('a peer with only identity (no pointer yet) still shows as online', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = new Awareness(docA)
    const b = new Awareness(docB)

    setLocalPresenceUser(a, { id: 'wbtest_a', name: 'Alice' })
    // B publishes nothing → must not appear as a phantom collaborator.
    sync(a, b)
    sync(b, a)

    expect(presenceDelta(b)).toBe(1) // B sees A (online, no cursor)
    expect(presenceDelta(a)).toBe(0) // A does not see an empty B
    expect(readBoardCollaborators(b).get(String(a.clientID))?.pointer).toBeUndefined()
  })

  it('clearing the local pointer drops the cursor but the peer stays online', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = new Awareness(docA)
    const b = new Awareness(docB)

    setLocalPresenceUser(a, { id: 'wbtest_a', name: 'Alice' })
    publishLocalPointer(a, { x: 10, y: 10 }, 'up')
    sync(a, b)
    expect(readBoardCollaborators(b).get(String(a.clientID))?.pointer).toEqual({ x: 10, y: 10 })

    clearLocalPointer(a)
    sync(a, b)
    const seen = readBoardCollaborators(b).get(String(a.clientID))
    expect(seen?.pointer).toBeUndefined() // cursor gone
    expect(seen?.username).toBe('Alice') // still online
  })
})

describe('collaborator label resolves uid → display name (XIN-680)', () => {
  const UID = '5904fca8ebe44ee6a8d8d7bd92228e0e' // the raw 32-hex id from the boss screenshot

  it('overwrites a peer-published raw uid with the viewer directory name, keyed by id', () => {
    const docA = new Y.Doc()
    const docB = new Y.Doc()
    const a = new Awareness(docA)
    const b = new Awareness(docB)

    // A's own member list had not resolved, so it broadcasts its uid as the name (userName || uid).
    setLocalPresenceUser(a, { id: UID, name: UID })
    publishLocalPointer(a, { x: 10, y: 10 }, 'up')
    const update = encodeAwarenessUpdate(a, Array.from(a.getStates().keys()))
    applyAwarenessUpdate(b, update, 'remote')

    const raw = readBoardCollaborators(b).get(String(a.clientID))
    expect(raw?.username).toBe(UID) // pre-fix: the id leaks into the label

    // B's space-member directory knows the name → the label resolves to it.
    const names = new Map([[UID, 'Ada Lovelace']])
    const resolved = resolveCollaboratorNames(readBoardCollaborators(b), names).get(String(a.clientID))
    expect(resolved?.username).toBe('Ada Lovelace')
  })

  it('keeps the peer-published username when the uid is unknown to the viewer', () => {
    const map = new Map<string, BoardCollaborator>([['c1', { id: 'unknown-uid', username: 'Bob' }]])
    resolveCollaboratorNames(map, new Map())
    expect(map.get('c1')?.username).toBe('Bob')
  })

  it('resolves a peer that published no name at all once the directory is known', () => {
    const map = new Map<string, BoardCollaborator>([['c1', { id: UID }]])
    resolveCollaboratorNames(map, new Map([[UID, 'Ada Lovelace']]))
    expect(map.get('c1')?.username).toBe('Ada Lovelace')
  })
})
