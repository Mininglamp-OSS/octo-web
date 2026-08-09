// Render cover for the people-picker's SEED step — the one behaviour in this file that is not
// cosmetic.
//
// `setOldCollaboratorList` is the baseline Univer diffs against on save: if it does not hold the
// rule's stored grant, `update()` is called with whatever `selectUserList` happens to contain and an
// empty array means "revoke everyone" (pinned in protectionAuthz.test.ts). The seed therefore has to
// happen for an existing rule REGARDLESS of whether the member roster has arrived — the roster only
// supplies display names, while the grant comes from readGrantAllow(), which reads the Y.Doc and
// needs no network. Gating the seed on the roster made a cosmetic fetch load-bearing for a
// correctness path, and because listProtectionMembers() swallows fetch errors and returns [], the
// window was permanent for that panel session rather than transient.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import * as Y from 'yjs'

// ── Univer seam ───────────────────────────────────────────────────────────────────────────────
// The component resolves SheetPermissionUserManagerService through useDependency and reads a couple
// of observables off it. We only care about the two setters, so the service is a spy record.
const userSvc = {
  setSelectUserList: vi.fn(),
  setOldCollaboratorList: vi.fn(),
  setCanEditUserList: vi.fn(),
  selectUserList$: { subscribe: () => ({ unsubscribe: () => {} }) },
  canEditUserList$: { subscribe: () => ({ unsubscribe: () => {} }) },
}

vi.mock('@univerjs/preset-sheets-core', () => ({
  EditStateEnum: { OnlyMe: 0, DesignedUserCanEdit: 1 },
  ViewStateEnum: { OthersCanView: 0, NoOneElseCanView: 1 },
  SheetPermissionUserManagerService: class {},
  useDependency: () => userSvc,
  useObservable: () => [],
}))

vi.mock('../members/useMemberNames.ts', () => ({
  // Real shape: Map<uid, name>. Empty here — displayName() falls back to the uid, which is exactly
  // the "names have not arrived" state this test is about.
  useMemberNames: () => new Map<string, string>(),
}))

vi.mock('../octoweb/index.ts', () => ({ t: (k: string) => k }))

// The roster fetch: resolves EMPTY, which is both the pre-arrival state and what
// listProtectionMembers() returns when GET /docs/:docId/members errors.
const listProtectionMembers = vi.fn(async () => [] as Array<{ uid: string; name?: string }>)
const readGrantAllow = vi.fn((_permissionId: string) => ['alice', 'bob'])

vi.mock('./protectionAuthz.ts', () => ({
  canAdministerProtection: () => true,
  getProtectionSpaceId: () => 'space-1',
  listProtectionMembers: (...a: unknown[]) => listProtectionMembers(...(a as [])),
  readGrantAllow: (...a: unknown[]) => readGrantAllow(...(a as [string])),
}))

const { ProtectionUserPart } = await import('./ProtectionUserPart.tsx')

const props = {
  editState: 1 as never,
  onEditStateChange: vi.fn(),
  viewState: 0 as never,
  onViewStateChange: vi.fn(),
  owner: { doc: new Y.Doc() } as never,
}

beforeEach(() => {
  userSvc.setSelectUserList.mockClear()
  userSvc.setOldCollaboratorList.mockClear()
  readGrantAllow.mockClear()
})
afterEach(() => cleanup())

const uidsOf = (call: unknown[]) =>
  ((call[0] as Array<Record<string, unknown>>) ?? []).map((c) => c.id ?? c.uid ?? c.userID)

describe('ProtectionUserPart — seeding an EXISTING rule must not wait on the member roster', () => {
  it('seeds setOldCollaboratorList from the stored grant even when members is empty', async () => {
    // The failing shape: roster never arrives (or errored), rule HAS grantees. Before the fix the
    // early return fired and the baseline stayed unset, so a later radio flip saved `[]` = revoke all.
    render(<ProtectionUserPart {...props} permissionId="perm-1" />)
    await waitFor(() => expect(userSvc.setOldCollaboratorList).toHaveBeenCalled())
    expect(uidsOf(userSvc.setOldCollaboratorList.mock.calls.at(-1)!)).toEqual(['alice', 'bob'])
  })

  it('seeds setSelectUserList from the stored grant even when members is empty', async () => {
    render(<ProtectionUserPart {...props} permissionId="perm-1" />)
    await waitFor(() => expect(userSvc.setSelectUserList).toHaveBeenCalled())
    expect(uidsOf(userSvc.setSelectUserList.mock.calls.at(-1)!)).toEqual(['alice', 'bob'])
  })

  it('marks a grant-bearing rule as 指定用户 without the roster', async () => {
    // Same reasoning: the edit-state mirror is derived from the grant, not from the roster.
    const onEditStateChange = vi.fn()
    render(<ProtectionUserPart {...props} onEditStateChange={onEditStateChange} permissionId="perm-1" />)
    await waitFor(() => expect(onEditStateChange).toHaveBeenCalledWith(1))
  })

  it('does NOT leak rule A\u2019s grant into rule B when B mounts without a roster', async () => {
    // Scenario B from the review: the service is a DI singleton, so an unseeded panel leaves the
    // PREVIOUS rule's list in place and rule B gets saved with rule A's grantees.
    readGrantAllow.mockImplementation((permissionId: string) =>
      permissionId === 'perm-A' ? ['alice'] : ['bob'],
    )
    const a = render(<ProtectionUserPart {...props} permissionId="perm-A" />)
    await waitFor(() => expect(userSvc.setOldCollaboratorList).toHaveBeenCalled())
    a.unmount()
    userSvc.setOldCollaboratorList.mockClear()

    render(<ProtectionUserPart {...props} permissionId="perm-B" />)
    await waitFor(() => expect(userSvc.setOldCollaboratorList).toHaveBeenCalled())
    expect(uidsOf(userSvc.setOldCollaboratorList.mock.calls.at(-1)!)).toEqual(['bob'])
  })

  it('still resets to empty for a rule being CREATED (no permissionId)', async () => {
    // Guard against over-correcting: a new rule must NOT inherit the previous rule's selection.
    render(<ProtectionUserPart {...props} permissionId="" />)
    await waitFor(() => expect(userSvc.setOldCollaboratorList).toHaveBeenCalled())
    expect(uidsOf(userSvc.setOldCollaboratorList.mock.calls.at(-1)!)).toEqual([])
  })
})
