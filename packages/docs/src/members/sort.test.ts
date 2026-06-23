import { describe, it, expect } from 'vitest'
import { sortMembersForDisplay, sortPickerMembers } from './sort.ts'
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
