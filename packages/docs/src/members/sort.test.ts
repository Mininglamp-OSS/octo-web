import { describe, it, expect } from 'vitest'
import { sortMembersForDisplay, sortPickerMembers, withSyntheticOwner, applyOrderSnapshot } from './sort.ts'
import type { Member } from './api.ts'
import type { SpaceMemberLite } from '../octoweb/index.ts'

function member(uid: string, role: Member['role']): Member {
  return { uid, role, source: 'direct', grantedBy: 'u_admin' }
}

describe('sortMembersForDisplay (#A3)', () => {
  it('pins the owner first, then orders by role (admin → writer → reader)', () => {
    const members = [
      member('u_reader', 'reader'),
      member('u_admin', 'admin'),
      member('u_owner', 'reader'),
      member('u_writer', 'writer'),
    ]
    const sorted = sortMembersForDisplay(members, 'u_owner').map((m) => m.uid)
    expect(sorted).toEqual(['u_owner', 'u_admin', 'u_writer', 'u_reader'])
  })

  it('is stable within a role group and works without an owner', () => {
    const members = [member('a', 'writer'), member('b', 'writer'), member('c', 'reader')]
    expect(sortMembersForDisplay(members).map((m) => m.uid)).toEqual(['a', 'b', 'c'])
  })
})

describe('withSyntheticOwner (#A1/#A3, Option A)', () => {
  it('prepends a synthetic owner row when the owner is absent from the members list', () => {
    const members = [member('w1', 'writer'), member('w2', 'writer')]
    const out = withSyntheticOwner(members, 'u_owner')
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ uid: 'u_owner', source: 'owner' })
    // sorted view pins the synthetic owner first
    expect(sortMembersForDisplay(out, 'u_owner').map((m) => m.uid)).toEqual(['u_owner', 'w1', 'w2'])
  })

  it('does not duplicate when the owner already appears in the members list', () => {
    const members = [member('u_owner', 'admin'), member('w1', 'writer')]
    const out = withSyntheticOwner(members, 'u_owner')
    expect(out).toHaveLength(2)
    expect(out.filter((m) => m.uid === 'u_owner')).toHaveLength(1)
  })

  it('is a no-op without an ownerId', () => {
    const members = [member('w1', 'writer')]
    expect(withSyntheticOwner(members, undefined)).toEqual(members)
  })
})

describe('sortPickerMembers (#A3)', () => {
  it('pins already-added members to the top, preserving order within each group', () => {
    const roster: SpaceMemberLite[] = [
      { uid: 'a', name: 'A' },
      { uid: 'b', name: 'B' },
      { uid: 'c', name: 'C' },
      { uid: 'd', name: 'D' },
    ]
    const sorted = sortPickerMembers(roster, new Set(['b', 'd'])).map((m) => m.uid)
    expect(sorted).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('applyOrderSnapshot (need #4 — frozen order)', () => {
  const row = (uid: string) => ({ uid })

  it('orders rows by their snapshot index, ignoring incoming order (in-snapshot case)', () => {
    // Snapshot froze the order [a, b, c]; rows arrive shuffled (e.g. a re-rank after a role change).
    const snapshot = new Map([['a', 0], ['b', 1], ['c', 2]])
    const rows = [row('c'), row('a'), row('b')]
    expect(applyOrderSnapshot(rows, snapshot).map((r) => r.uid)).toEqual(['a', 'b', 'c'])
  })

  it('appends uids absent from the snapshot after all snapshot rows, keeping their relative order (out-of-snapshot case)', () => {
    const snapshot = new Map([['a', 0], ['b', 1]])
    // x and y are new (not snapshotted) and arrive interleaved; they must land AFTER a,b in arrival order.
    const rows = [row('y'), row('a'), row('x'), row('b')]
    expect(applyOrderSnapshot(rows, snapshot).map((r) => r.uid)).toEqual(['a', 'b', 'y', 'x'])
  })

  it('simply omits snapshot uids that have disappeared from rows (removed case)', () => {
    const snapshot = new Map([['a', 0], ['b', 1], ['c', 2]])
    // b was removed; the remaining rows keep their frozen relative order.
    const rows = [row('c'), row('a')]
    expect(applyOrderSnapshot(rows, snapshot).map((r) => r.uid)).toEqual(['a', 'c'])
  })

  it('is a stable pass-through when the snapshot is empty (all rows treated as new)', () => {
    const rows = [row('a'), row('b'), row('c')]
    expect(applyOrderSnapshot(rows, new Map()).map((r) => r.uid)).toEqual(['a', 'b', 'c'])
  })
})
