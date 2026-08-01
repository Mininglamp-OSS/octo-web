// Authorization half of sheet protection. These tests exist because the RULE sync in binding.ts is
// only half a fix: Univer asks IAuthzIoService whether a user may edit inside a protected range, and
// the stock service answers "yes" for any permissionId it has not seen. So the assertions below are
// mostly about the DENY paths — a false allow here is the reported bug reappearing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import {
  OctoAuthzIoService,
  setProtectionAuthzContext,
  clearProtectionAuthzContext,
  SHEET_PROTECTION_GRANTS_FIELD,
  setGrantAllow,
  readGrantAllow,
  getProtectionSpaceId,
  canAdministerProtection,
  type StoredGrant,
} from './protectionAuthz.ts'
import { SHEET_PERMISSION_POINTS_FIELD, SHEET_PROTECTION_FIELD } from './binding.ts'
import type { Role } from '../auth/roles.ts'

const ACTION_VIEW = 0
const ACTION_EDIT = 1
const ACTION_MANAGE_COLLABORATOR = 2
/**
 * Univer queries protection rules with `baseProtectionActions = [Edit, View, ManageCollaborator, Delete]`.
 * `Delete` gates 「删除保护范围」/「移除工作表保护」 — it must be withheld, or the feature is bypassed
 * by deleting the lock instead of writing through it.
 */
const ACTION_DELETE = 42

const ROLE_READER = 0
const ROLE_EDITOR = 1
const ROLE_OWNER = 2

function wire(opts: { uid: string; role: Role; members?: Array<{ uid: string; name?: string }> }) {
  const ydoc = new Y.Doc()
  setProtectionAuthzContext({
    ydoc,
    uid: opts.uid,
    role: () => opts.role,
    ...(opts.members ? { listMembers: async () => opts.members! } : {}),
  })
  const svc = new OctoAuthzIoService()
  const grants = ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD)
  return { ydoc, svc, grants }
}

async function mayEdit(svc: OctoAuthzIoService, objectID: string): Promise<boolean> {
  const res = await svc.allowed({ objectID, actions: [ACTION_EDIT] })
  return res[0]!.allowed
}

afterEach(() => clearProtectionAuthzContext())

describe('OctoAuthzIoService — grants persist in the Y.Doc (bug 1, the enforcement half)', () => {
  it('create() records a grant keyed by the returned objectID', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({ selectRangeObject: { collaborators: [] } })
    expect(objectID).toMatch(/^[0-9a-f]{24}$/)
    expect(grants.get(objectID)).toEqual({ allow: [], createdBy: 'u-admin' })
  })

  it('create() seeds the allow-list from the collaborators the panel passed', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({
      selectRangeObject: {
        collaborators: [
          { id: 'ignored', role: ROLE_EDITOR, subject: { userID: 'u-bob', name: 'Bob', avatar: '', anonymous: false, canBindAnonymous: false } },
          { id: 'u-carol', role: ROLE_EDITOR },
        ],
      },
    })
    expect(grants.get(objectID)!.allow).toEqual(['u-bob', 'u-carol'])
  })

  it('a grant written by a peer survives into this client (it is ordinary shared state)', async () => {
    const { svc, ydoc } = wire({ uid: 'u-bob', role: 'writer' })
    // Simulate replication: a peer's grant arrives as a normal Yjs update.
    const peer = new Y.Doc()
    peer.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('obj-1', { allow: ['u-bob'] })
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peer))
    expect(await mayEdit(svc, 'obj-1')).toBe(true)
  })
})

describe('OctoAuthzIoService — allowed() (bug 2: peers edited straight through the lock)', () => {
  it('DENIES a non-admin who is not on the allow-list', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('obj-1', { allow: ['u-carol'] })
    expect(await mayEdit(svc, 'obj-1')).toBe(false)
  })

  it('ALLOWS an objectID that is not a protection object at all (WS-PROT-2 regression)', async () => {
    // Univer routes its own workbook/worksheet permission points through allowed(). Denying an id
    // we never protected made EVERY cell read-only and shaded the whole sheet. Not ours -> allow.
    const { svc } = wire({ uid: 'u-bob', role: 'writer' })
    expect(await mayEdit(svc, 'univer-worksheet-edit-point')).toBe(true)
  })

  it('DENIES a non-admin for a rule-referenced object whose grant has not replicated yet', async () => {
    // A rule can arrive before its grant. That window must fail CLOSED — but only because the rule
    // positively identifies the id as protected.
    const { svc, ydoc } = wire({ uid: 'u-bob', role: 'writer' })
    ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', { kind: 'r', id: 'r1', permissionId: 'perm-1' })
    expect(await mayEdit(svc, 'perm-1')).toBe(false)
  })

  it('DENIES a non-admin for a granted-but-empty allow-list', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: [] })
    expect(await mayEdit(svc, 'perm-1')).toBe(false)
  })

  it('ALLOWS a non-admin explicitly granted', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('obj-1', { allow: ['u-bob'] })
    expect(await mayEdit(svc, 'obj-1')).toBe(true)
  })

  it('ALLOWS an admin regardless of the allow-list', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('obj-1', { allow: ['someone-else'] })
    expect(await mayEdit(svc, 'obj-1')).toBe(true)
  })

  it('never withholds VIEW — a range rule restricts editing, not reading', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('obj-1', { allow: [] })
    const res = await svc.allowed({ objectID: 'obj-1', actions: [ACTION_VIEW] })
    expect(res[0]!.allowed).toBe(true)
  })

  it('guards cell edits and collaborator management, not unrelated actions', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('obj-1', { allow: [] })
    const res = await svc.allowed({
      objectID: 'obj-1',
      actions: [ACTION_EDIT, ACTION_MANAGE_COLLABORATOR, 8 /* Export */],
    })
    expect(res.map((r) => r.allowed)).toEqual([false, false, true])
  })

  it('reflects a LIVE role downgrade without rebuilding the service', async () => {
    const ydoc = new Y.Doc()
    let role: Role = 'admin'
    setProtectionAuthzContext({ ydoc, uid: 'u-x', role: () => role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('obj-1', { allow: [] })
    expect(await mayEdit(svc, 'obj-1')).toBe(true)
    role = 'writer' // e.g. the backend downgraded this session mid-edit
    expect(await mayEdit(svc, 'obj-1')).toBe(false)
  })

  it('batchAllowed answers per object', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('open', { allow: ['u-bob'] })
    grants.set('shut', { allow: [] })
    const res = await svc.batchAllowed([
      { objectID: 'open', actions: [ACTION_EDIT] },
      { objectID: 'shut', actions: [ACTION_EDIT] },
    ])
    expect(res.map((r) => [r.objectID, r.actions[0]!.allowed])).toEqual([
      ['open', true],
      ['shut', false],
    ])
  })
})

describe('OctoAuthzIoService — only an admin may CREATE a protected range (WS-PROT-3)', () => {
  it('REFUSES create() for a non-admin, and writes no grant', async () => {
    // Reported bug: a writer could open the panel and protect a range. The new grant's allow-list
    // starts empty, so the creator immediately locked themselves out of the cells they just
    // protected. Refusing here aborts Univer's command, so no rule is minted at all.
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    await expect(svc.create({ selectRangeObject: { collaborators: [] } })).rejects.toThrow(
      /protection_admin_only/,
    )
    expect(grants.size).toBe(0)
  })

  it('REFUSES create() for a reader too', async () => {
    const { svc, grants } = wire({ uid: 'u-r', role: 'reader' })
    await expect(svc.create({ worksheetObject: { collaborators: [] } })).rejects.toThrow(
      /protection_admin_only/,
    )
    expect(grants.size).toBe(0)
  })

  it('still allows an admin to create', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({ selectRangeObject: { collaborators: [] } })
    expect(grants.get(objectID)).toEqual({ allow: [], createdBy: 'u-admin' })
  })
})

describe('OctoAuthzIoService — only an admin may change who is granted', () => {
  it('ignores a non-admin trying to grant themselves', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('obj-1', { allow: [] })
    await svc.createCollaborator({ objectID: 'obj-1', collaborators: [{ id: 'u-bob', role: ROLE_EDITOR }] })
    expect(grants.get('obj-1')!.allow).toEqual([])
    expect(await mayEdit(svc, 'obj-1')).toBe(false)
  })

  it('an admin can add and then remove a collaborator', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('obj-1', { allow: [], createdBy: 'u-admin' })
    await svc.createCollaborator({ objectID: 'obj-1', collaborators: [{ id: 'u-bob', role: ROLE_EDITOR }] })
    expect(grants.get('obj-1')!.allow).toEqual(['u-bob'])
    await svc.deleteCollaborator({ objectID: 'obj-1', collaboratorID: 'u-bob' })
    expect(grants.get('obj-1')!.allow).toEqual([])
    // createdBy must survive the round trip (the panel shows it).
    expect(grants.get('obj-1')!.createdBy).toBe('u-admin')
  })

  it('putCollaborators REPLACES the list wholesale for an admin', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('obj-1', { allow: ['u-old'], createdBy: 'u-admin' })
    await svc.putCollaborators({ objectID: 'obj-1', collaborators: [{ id: 'u-new', role: ROLE_EDITOR }] })
    expect(grants.get('obj-1')!.allow).toEqual(['u-new'])
  })

  it('putCollaborators is a no-op for a non-admin', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('obj-1', { allow: ['u-old'] })
    await svc.putCollaborators({ objectID: 'obj-1', collaborators: [{ id: 'u-bob', role: ROLE_EDITOR }] })
    expect(grants.get('obj-1')!.allow).toEqual(['u-old'])
  })

  it('does not create a grant for an unknown object on a stray collaborator call', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    await svc.deleteCollaborator({ objectID: 'ghost', collaborators: [] })
    expect(grants.has('ghost')).toBe(false)
  })
})

describe('OctoAuthzIoService — listCollaborators (bug 3: the picker was structurally empty)', () => {
  it('returns doc members, marking the granted ones as editors', async () => {
    const { svc, grants } = wire({
      uid: 'u-admin',
      role: 'admin',
      members: [{ uid: 'u-bob', name: 'Bob' }, { uid: 'u-carol', name: 'Carol' }],
    })
    grants.set('obj-1', { allow: ['u-carol'] })
    const list = await svc.listCollaborators({ objectID: 'obj-1' })
    expect(list.map((c) => [c.subject?.userID, c.subject?.name, c.role])).toEqual([
      ['u-bob', 'Bob', ROLE_READER],
      ['u-carol', 'Carol', ROLE_EDITOR],
    ])
  })

  it('falls back to the granted uids when the member fetch fails', async () => {
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({
      ydoc,
      uid: 'u-admin',
      role: () => 'admin',
      listMembers: async () => { throw new Error('offline') },
    })
    const svc = new OctoAuthzIoService()
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('obj-1', { allow: ['u-carol'] })
    const list = await svc.listCollaborators({ objectID: 'obj-1' })
    // Stock behaviour here is `[]` — the empty dialog. We at least show who is already granted.
    expect(list.map((c) => c.id)).toEqual(['u-carol'])
  })
})

describe('OctoAuthzIoService — unwired context now fails CLOSED (WS-PROT-6a)', () => {
  beforeEach(() => clearProtectionAuthzContext())

  it('DENIES guarded actions when no context is installed', async () => {
    // Policy reversal. This used to return "allowed" so a wiring regression could not brick a sheet
    // — but that made the regression look identical to "protection quietly disappeared", the exact
    // failure mode this feature exists to remove. Now it is loud instead of silent.
    const svc = new OctoAuthzIoService()
    expect(await mayEdit(svc, 'obj-1')).toBe(false)
    const res = await svc.allowed({ objectID: 'obj-1', actions: [ACTION_DELETE, ACTION_MANAGE_COLLABORATOR] })
    expect(res.map((r) => r.allowed)).toEqual([false, false])
  })

  it('still ALLOWS unguarded actions, so an unwired sheet stays editable outside protected ranges', async () => {
    const svc = new OctoAuthzIoService()
    const res = await svc.allowed({ objectID: 'obj-1', actions: [ACTION_VIEW, 8 /* Export */] })
    expect(res.map((r) => r.allowed)).toEqual([true, true])
  })
})

// ---------------------------------------------------------------------------
// WS-PROT-5 — two review blockers found by Lucy. Both are the SAME failure mode this whole feature
// exists to prevent: the panel says one thing and enforcement does another, so the lock is
// decoration. Regression cover is deny-side.
// ---------------------------------------------------------------------------

const EDIT_STATE_ONLY_ME = 'onlyMe'
const EDIT_STATE_DESIGNATED = 'designedUserCanEdit'

/** Seed a rule so findProtectionRule() can read its editState, plus its grant. */
function wireRule(opts: {
  uid: string
  role: Role
  editState: string
  allow: string[]
  createdBy?: string
}) {
  const w = wire({ uid: opts.uid, role: opts.role })
  w.ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
    kind: 'r', id: 'r1', permissionId: 'perm-1', editState: opts.editState,
  })
  w.grants.set('perm-1', {
    allow: opts.allow,
    ...(opts.createdBy ? { createdBy: opts.createdBy } : {}),
  })
  return w
}

describe('OctoAuthzIoService — 仅我可以编辑 must actually revoke (WS-PROT-5a)', () => {
  it('DENIES a previously-granted user once editState is OnlyMe', async () => {
    // The reported hole: an admin grants Bob, then switches the rule to 「仅我可以编辑」. Reading only
    // the allow-list left Bob writing while the panel claimed nobody but the owner could.
    const { svc } = wireRule({
      uid: 'u-bob', role: 'writer',
      editState: EDIT_STATE_ONLY_ME, allow: ['u-bob'], createdBy: 'u-admin',
    })
    expect(await mayEdit(svc, 'perm-1')).toBe(false)
  })

  it('ALLOWS the rule CREATOR under OnlyMe — "me" is who made the rule', async () => {
    const { svc } = wireRule({
      uid: 'u-admin', role: 'writer', // not an admin role: allowed purely by being the creator
      editState: EDIT_STATE_ONLY_ME, allow: [], createdBy: 'u-admin',
    })
    expect(await mayEdit(svc, 'perm-1')).toBe(true)
  })

  it('still honours the allow-list under DesignedUserCanEdit', async () => {
    const { svc } = wireRule({
      uid: 'u-bob', role: 'writer',
      editState: EDIT_STATE_DESIGNATED, allow: ['u-bob'], createdBy: 'u-admin',
    })
    expect(await mayEdit(svc, 'perm-1')).toBe(true)
  })

  it('a doc admin is allowed even under OnlyMe by someone else', async () => {
    const { svc } = wireRule({
      uid: 'u-other-admin', role: 'admin',
      editState: EDIT_STATE_ONLY_ME, allow: [], createdBy: 'u-admin',
    })
    expect(await mayEdit(svc, 'perm-1')).toBe(true)
  })

  it('DENIES under OnlyMe when the grant records no creator at all', async () => {
    const { svc } = wireRule({
      uid: 'u-bob', role: 'writer',
      editState: EDIT_STATE_ONLY_ME, allow: ['u-bob'], // no createdBy
    })
    expect(await mayEdit(svc, 'perm-1')).toBe(false)
  })
})

describe('OctoAuthzIoService — a READER must not be promoted to editor (WS-PROT-5b)', () => {
  const reader = (uid: string) => ({ id: uid, role: ROLE_READER })
  const editor = (uid: string) => ({ id: uid, role: ROLE_EDITOR })

  it('putCollaborators grants ONLY the editor-role entries', async () => {
    // Univer's own dialog hands back the whole roster with unselected members marked ROLE_READER
    // (listCollaborators does exactly that), so taking the list verbatim granted everybody.
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    await svc.putCollaborators({
      objectID: 'perm-1',
      collaborators: [reader('u-reader'), editor('u-editor')],
    })
    expect(grants.get('perm-1')!.allow).toEqual(['u-editor'])
  })

  it('create() seeds only the editor-role entries', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({
      selectRangeObject: { collaborators: [reader('u-reader'), editor('u-editor')] },
    })
    expect(grants.get(objectID)!.allow).toEqual(['u-editor'])
  })

  it('createCollaborator/updateCollaborator ignore reader-role entries', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    await svc.createCollaborator({ objectID: 'perm-1', collaborators: [reader('u-reader')] })
    expect(grants.get('perm-1')!.allow).toEqual([])
    await svc.updateCollaborator({ objectID: 'perm-1', collaborators: [editor('u-editor')] })
    expect(grants.get('perm-1')!.allow).toEqual(['u-editor'])
  })

  it('fails closed on a collaborator with a missing role', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    await svc.putCollaborators({
      objectID: 'perm-1',
      collaborators: [{ id: 'u-norole' } as unknown as { id: string; role: number }],
    })
    expect(grants.get('perm-1')!.allow).toEqual([])
  })

  it('REVOKE must NOT filter on role — a reader-role removal still removes', async () => {
    // The trap Lucy flagged: adding the same role filter to deleteCollaborator would make
    // revocation silently no-op, because a removed collaborator can arrive with any role.
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-bob'], createdBy: 'u-admin' })
    await svc.deleteCollaborator({ objectID: 'perm-1', collaborators: [reader('u-bob')] })
    expect(grants.get('perm-1')!.allow).toEqual([])
  })

  it('REVOKE by collaboratorID still works', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-bob'], createdBy: 'u-admin' })
    await svc.deleteCollaborator({ objectID: 'perm-1', collaboratorID: 'u-bob' })
    expect(grants.get('perm-1')!.allow).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// WS-PROT-6 — reviewer blocker (PR #1190, P1-1). Reproduced before fixing:
//   allowed({ objectID:'perm-1', actions:[1,0,2,42] })  role=writer, grant.allow=[]
//     → [{1,false},{0,true},{2,false},{42,TRUE}]      ← Delete was wide open
// Univer feeds action 42 into RangeProtectionPermissionDeleteProtectionPoint /
// WorksheetDeleteProtectionPermission, which gate 「删除保护范围」/「移除工作表保护」. With it
// unguarded a plain writer could DELETE the rule for every peer — the feature bypassed by
// removing the lock rather than writing through it. Same decorative-lock failure, one level up.
// ---------------------------------------------------------------------------

describe('OctoAuthzIoService — a non-admin must not be able to DELETE a protection rule (WS-PROT-6)', () => {
  it('withholds Delete from a plain writer who is not on the allow-list', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    const res = await svc.allowed({ objectID: 'perm-1', actions: [ACTION_DELETE] })
    expect(res[0]?.allowed).toBe(false)
  })

  it('withholds Delete even from a writer who IS on the allow-list (edit ≠ administer)', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: ['u-bob'], createdBy: 'u-admin' })
    const edit = await svc.allowed({ objectID: 'perm-1', actions: [ACTION_EDIT] })
    const del = await svc.allowed({ objectID: 'perm-1', actions: [ACTION_DELETE] })
    expect(edit[0]?.allowed).toBe(true)
    expect(del[0]?.allowed).toBe(false)
  })

  it('still lets a doc admin delete the rule', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    const res = await svc.allowed({ objectID: 'perm-1', actions: [ACTION_DELETE] })
    expect(res[0]?.allowed).toBe(true)
  })

  it('answers all four of Univer baseProtectionActions, with View never withheld', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    const res = await svc.allowed({
      objectID: 'perm-1',
      actions: [ACTION_EDIT, ACTION_VIEW, ACTION_MANAGE_COLLABORATOR, ACTION_DELETE],
    })
    // View stays true by design (share scope hides content, not a range rule); the other three deny.
    expect(res.map((r) => r.allowed)).toEqual([false, true, false, false])
  })
})

/**
 * WS-PROT-6f — the OTHER half of the overlap problem.
 *
 * WS-PROT-6b hardened TEARDOWN with an ownership token so a late `destroy()` cannot disarm the live
 * sheet. INSTALL was left unconditional, and that is the same fail-open from the opposite direction:
 * during the overlap window the still-mounted OUTGOING service resolved the INCOMING sheet's context.
 * Its own permissionIds are absent from that document, so `findProtectionRule` returned null and
 * `allowedFor` allowed — every protected range in the sheet the user is still looking at opened up.
 * On a writer → admin document transition `isAdmin()` flipped true for it as well.
 *
 * The fix is not "fail closed on mismatch" — that would needlessly lock a sheet that is working fine.
 * A service resolves the context it was CONSTRUCTED with, so each instance keeps enforcing against its
 * own document for as long as it is mounted.
 */
describe('OctoAuthzIoService — an overlapping sheet must not cross-wire (WS-PROT-6f)', () => {
  it('keeps enforcing against its OWN document after another sheet installs its context', async () => {
    const ydocA = new Y.Doc()
    const ctxA = { ydoc: ydocA, uid: 'u-bob', role: () => 'writer' as Role }
    setProtectionAuthzContext(ctxA)
    const svcA = new OctoAuthzIoService(ctxA)
    ydocA.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', { kind: 'r', id: 'r1', permissionId: 'perm-1' })
    ydocA.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', { allow: [] })
    expect(await mayEdit(svcA, 'perm-1')).toBe(false) // baseline: A enforces

    // The next sheet mounts and installs its own context BEFORE A's destroy() runs.
    const ydocB = new Y.Doc()
    setProtectionAuthzContext({ ydoc: ydocB, uid: 'u-bob', role: () => 'writer' as Role })

    // A's rule does not exist in B's document. Reading the module global here answered "not a
    // protection object → allow", silently unlocking the range the user still has on screen.
    expect(await mayEdit(svcA, 'perm-1')).toBe(false)
  })

  it('does not inherit the incoming sheet\'s ROLE (an admin document must not promote the old one)', async () => {
    const ydocA = new Y.Doc()
    const ctxA = { ydoc: ydocA, uid: 'u-bob', role: () => 'writer' as Role }
    setProtectionAuthzContext(ctxA)
    const svcA = new OctoAuthzIoService(ctxA)
    ydocA.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', { kind: 'r', id: 'r1', permissionId: 'perm-1' })
    ydocA.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', { allow: [] })

    // Same uid, different document, where they happen to be an admin.
    setProtectionAuthzContext({ ydoc: ydocA, uid: 'u-bob', role: () => 'admin' as Role })
    expect(await mayEdit(svcA, 'perm-1')).toBe(false)
  })

  it('a service constructed with no context still follows the module global (test/legacy wiring)', async () => {
    // The DI registration passes its context explicitly; everything else — including every other test
    // in this file — relies on the global. Both must keep working.
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: [] })
    expect(await mayEdit(svc, 'perm-1')).toBe(false)
  })
})

/**
 * WS-PROT-6g — the overlap fix covered the SERVICE but not the PICKER.
 *
 * WS-PROT-6f gave OctoAuthzIoService an instance-scoped context. The module-level accessors the
 * people-picker uses (`ProtectionUserPart` is rendered BY Univer, so it can only reach us through
 * them) were left reading the global, which is the same cross-wire one layer over:
 *
 *   - `setGrantAllow` WRITES. During the overlap window an admin's roster save on the sheet still on
 *     screen landed in the INCOMING document — the visible sheet's grant never changed (the revoked
 *     collaborator keeps editing), and a foreign document silently grew a grant for a rule it has no
 *     rule record for.
 *   - `canAdministerProtection` reads the incoming ROLE: a writer looking at doc A gets the picker in
 *     editable mode because doc B made them admin.
 *   - `readGrantAllow` / `getProtectionSpaceId` read the incoming document, so the picker shows the
 *     wrong roster for the rule it is editing.
 *
 * Same asymmetry as 6f: this is not \"fail closed on mismatch\", it is \"answer from the document you
 * were opened against\". The accessors therefore take an optional owner, and CollabSheet's picker
 * factory closes over its own context.
 */
describe('OctoAuthzIoService — the picker accessors must not cross-wire either (WS-PROT-6g)', () => {
  it('setGrantAllow writes to the document it was given, not whichever installed last', () => {
    const ydocA = new Y.Doc()
    const ctxA = { ydoc: ydocA, uid: 'u-admin', role: () => 'admin' as Role }
    setProtectionAuthzContext(ctxA)
    ydocA.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', { kind: 'r', id: 'r1', permissionId: 'perm-1' })
    ydocA.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', { allow: ['u-old'], createdBy: 'u-admin' })

    // The next sheet mounts before A's destroy runs.
    const ydocB = new Y.Doc()
    setProtectionAuthzContext({ ydoc: ydocB, uid: 'u-admin', role: () => 'admin' as Role })

    // The picker still on screen belongs to A and saves a roster edit.
    expect(setGrantAllow('perm-1', ['u-new'], ctxA)).toBe(true)

    // It must land in A — otherwise the revoked collaborator keeps write access on the visible sheet.
    expect(ydocA.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).get('perm-1')!.allow).toEqual(['u-new'])
    // And must NOT leak into the unrelated document.
    expect(ydocB.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).has('perm-1')).toBe(false)
  })

  it('setGrantAllow preserves the per-action strategies (a roster save is not a toggle reset)', () => {
    // Same class of bug as keepStrategies fixed on the service paths: this writer rebuilt the grant
    // record without restating `strategies`, so one 「添加人员」 save through the picker dropped every
    // toggle an admin had configured.
    const ydoc = new Y.Doc()
    const own = { ydoc, uid: 'u-admin', role: () => 'admin' as Role }
    setProtectionAuthzContext(own)
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', {
      allow: ['u-old'],
      createdBy: 'u-admin',
      strategies: [{ action: 17, role: 2 }], // ACTION_SORT / ROLE_OWNER — literals: both consts are declared below
    })

    expect(setGrantAllow('perm-1', ['u-new'], own)).toBe(true)
    expect(ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).get('perm-1')!.strategies)
      .toEqual([{ action: 17, role: 2 }])
  })

  it('canAdministerProtection does not inherit the incoming sheet\'s role', () => {
    const ydocA = new Y.Doc()
    const ctxA = { ydoc: ydocA, uid: 'u-bob', role: () => 'writer' as Role }
    setProtectionAuthzContext(ctxA)
    expect(canAdministerProtection(ctxA)).toBe(false) // baseline

    // Bob is an admin of the NEXT document. The picker on screen still belongs to A.
    setProtectionAuthzContext({ ydoc: new Y.Doc(), uid: 'u-bob', role: () => 'admin' as Role })
    expect(canAdministerProtection(ctxA)).toBe(false)
  })

  it('readGrantAllow / getProtectionSpaceId answer from their own document', () => {
    const ydocA = new Y.Doc()
    const ctxA = { ydoc: ydocA, uid: 'u-admin', role: () => 'admin' as Role, spaceId: 'space-A' }
    setProtectionAuthzContext(ctxA)
    ydocA.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', { allow: ['u-alice'] })

    const ydocB = new Y.Doc()
    ydocB.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', { allow: ['u-carol'] })
    setProtectionAuthzContext({ ydoc: ydocB, uid: 'u-admin', role: () => 'admin' as Role, spaceId: 'space-B' })

    expect(readGrantAllow('perm-1', ctxA)).toEqual(['u-alice'])
    expect(getProtectionSpaceId(ctxA)).toBe('space-A')
  })

  it('accessors called with NO owner still follow the module global (existing picker wiring)', () => {
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: 'u-admin', role: () => 'admin' as Role, spaceId: 'space-X' })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', { allow: ['u-alice'] })
    expect(readGrantAllow('perm-1')).toEqual(['u-alice'])
    expect(getProtectionSpaceId()).toBe('space-X')
    expect(canAdministerProtection()).toBe(true)
  })
})

describe('OctoAuthzIoService — teardown must not disarm a live sheet (WS-PROT-6b)', () => {
  it('a STALE owner clearing the context is a no-op', async () => {
    // Two overlapping CollabSheet instances (StrictMode double-mount, or route change before the
    // previous destroy). The outgoing instance used to null the incoming one's context, and with the
    // old fail-open default that silently unlocked every protected range in the live sheet.
    const stale = { ydoc: new Y.Doc(), uid: 'u-old', role: () => 'admin' as Role }
    setProtectionAuthzContext(stale)

    const live = wire({ uid: 'u-bob', role: 'writer' })
    live.grants.set('perm-1', { allow: [] })
    live.ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
      kind: 'r', id: 'r1', permissionId: 'perm-1', editState: 'designedUserCanEdit',
    })
    expect(await mayEdit(live.svc, 'perm-1')).toBe(false)

    // The outgoing instance tears down LATE, passing its own (now stale) context object.
    clearProtectionAuthzContext(stale)

    // The live sheet must still be enforcing — not fail-open, not admin-from-the-stale-context.
    expect(await mayEdit(live.svc, 'perm-1')).toBe(false)
  })

  it('the CURRENT owner clearing the context does take effect', async () => {
    const own = { ydoc: new Y.Doc(), uid: 'u-a', role: () => 'admin' as Role }
    setProtectionAuthzContext(own)
    clearProtectionAuthzContext(own)
    // Cleared => unwired => guarded actions now fail closed.
    const svc = new OctoAuthzIoService()
    expect(await mayEdit(svc, 'obj-1')).toBe(false)
  })
})

describe('OctoAuthzIoService — update() must apply the edited roster (WS-PROT-6c)', () => {
  it('REPLACES the allow-list from config.collaborators', async () => {
    // P1-2: update() used to take only objectID and re-write the grant unchanged, so an admin's
    // allow-list edit was silently dropped — panel showed the new list, enforcement kept the old.
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-old'], createdBy: 'u-admin' })
    await svc.update({
      objectID: 'perm-1',
      collaborators: [{ id: 'u-new', role: ROLE_EDITOR }],
    })
    expect(grants.get('perm-1')!.allow).toEqual(['u-new'])
    expect(grants.get('perm-1')!.createdBy).toBe('u-admin')
  })

  it('filters reader-role entries here too', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    await svc.update({
      objectID: 'perm-1',
      collaborators: [{ id: 'u-reader', role: ROLE_READER }, { id: 'u-editor', role: ROLE_EDITOR }],
    })
    expect(grants.get('perm-1')!.allow).toEqual(['u-editor'])
  })

  it('leaves the grant untouched when the payload carries NO roster', async () => {
    // A genuine perm-point-only update must not be read as "clear everyone".
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-keep'], createdBy: 'u-admin' })
    await svc.update({ objectID: 'perm-1' })
    expect(grants.get('perm-1')!.allow).toEqual(['u-keep'])
  })

  it('is a no-op for a non-admin', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: ['u-old'] })
    await svc.update({ objectID: 'perm-1', collaborators: [{ id: 'u-bob', role: ROLE_EDITOR }] })
    expect(grants.get('perm-1')!.allow).toEqual(['u-old'])
  })
})

describe('OctoAuthzIoService — list() must answer the actions the caller asked for (WS-PROT-6d)', () => {
  // The rule list in the panel resolves `ManageCollaborator` / `Delete` out of list()'s response to
  // decide whether to render 「编辑」/「删除」 on each rule. list() used to hard-code [View, Edit], so
  // those two lookups returned undefined → falsy → the icons were absent for EVERYONE, admins
  // included: a rule could be created and then never edited or removed. A rule you cannot delete is
  // worse than no rule.
  it('returns an entry for every requested action, not just View/Edit', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    const res = (await svc.list({
      unitID: 'unit-1',
      objectIDs: ['perm-1'],
      actions: [ACTION_EDIT, ACTION_VIEW, ACTION_MANAGE_COLLABORATOR, ACTION_DELETE],
    })) as Array<{ objectID: string; actions: Array<{ action: number; allowed: boolean }> }>
    expect(res[0]!.actions.map((a) => a.action)).toEqual([
      ACTION_EDIT, ACTION_VIEW, ACTION_MANAGE_COLLABORATOR, ACTION_DELETE,
    ])
    // Admin: manage + delete must be TRUE, otherwise the icons stay hidden.
    expect(res[0]!.actions.map((a) => a.allowed)).toEqual([true, true, true, true])
  })

  it('withholds manage/delete from a granted writer (edit yes, administer no)', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: ['u-bob'], createdBy: 'u-admin' })
    const res = (await svc.list({
      objectIDs: ['perm-1'],
      actions: [ACTION_EDIT, ACTION_MANAGE_COLLABORATOR, ACTION_DELETE],
    })) as Array<{ actions: Array<{ action: number; allowed: boolean }> }>
    expect(res[0]!.actions.map((a) => a.allowed)).toEqual([true, false, false])
  })

  it('falls back to the four base actions when the caller sends none', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    const res = (await svc.list({ objectIDs: ['perm-1'] })) as Array<{
      actions: Array<{ action: number }>
    }>
    expect(res[0]!.actions.map((a) => a.action)).toEqual([
      ACTION_VIEW, ACTION_EDIT, ACTION_MANAGE_COLLABORATOR, ACTION_DELETE,
    ])
  })
})

describe('OctoAuthzIoService — update() accepts the panel NESTED roster shape (WS-PROT-6e)', () => {
  // Univer's panel save calls `authzIoService.update({ ..., collaborators: { collaborators: [...] } })`
  // — NESTED — while the collaborator methods pass a flat array. update() tested Array.isArray on the
  // outer value, so the panel's own save was read as "no roster" and skipped: the admin saw the new
  // roster in the UI while enforcement kept the old one. Silent, and exactly the drift this feature
  // exists to remove.
  it('applies a roster sent as { collaborators: [...] }', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-old'], createdBy: 'u-admin' })
    await svc.update({
      objectID: 'perm-1',
      collaborators: { collaborators: [{ id: 'u-new', role: ROLE_EDITOR }] },
    })
    expect(grants.get('perm-1')!.allow).toEqual(['u-new'])
    expect(grants.get('perm-1')!.createdBy).toBe('u-admin')
  })

  it('an EMPTY nested roster revokes everyone (not "leave it alone")', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-old'], createdBy: 'u-admin' })
    await svc.update({ objectID: 'perm-1', collaborators: { collaborators: [] } })
    expect(grants.get('perm-1')!.allow).toEqual([])
  })

  it('still ignores a payload with no roster at all', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-keep'], createdBy: 'u-admin' })
    await svc.update({ objectID: 'perm-1', collaborators: {} })
    expect(grants.get('perm-1')!.allow).toEqual(['u-keep'])
  })

  it('putCollaborators accepts the nested shape too', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: ['u-old'], createdBy: 'u-admin' })
    await svc.putCollaborators({
      objectID: 'perm-1',
      collaborators: { collaborators: [{ id: 'u-new', role: ROLE_EDITOR }] },
    })
    expect(grants.get('perm-1')!.allow).toEqual(['u-new'])
  })
})

// ---------------------------------------------------------------------------
// WS-PROT-8 — 「更改工作表权限」 strategies, now IMPLEMENTED rather than hidden.
//
// A strategy row is {action, role}: the minimum UnitRole allowed to perform that action on the
// protected object. Before this, list() returned [] and the save path dropped the toggles, so the
// dialog padded itself on first open and rendered empty on reopen — input silently discarded.
//
// The trap these tests pin: the toggles cover actions (Sort 17, Filter 18, SetCellStyle 33) that are
// NOT in GUARDED_ACTIONS, so `allowedFor`'s early-return skipped them entirely. Stored-but-ignored
// would have been the same shell in a new costume.
// ---------------------------------------------------------------------------

const ACTION_SORT = 17
const ACTION_FILTER = 18
const ACTION_SET_CELL_STYLE = 33

/** Rule + grant + strategy rows, all seeded. */
function wireStrategy(opts: {
  uid: string
  role: Role
  allow: string[]
  strategies: Array<{ action: number; role: number }>
}) {
  const w = wire({ uid: opts.uid, role: opts.role })
  w.ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
    kind: 'r', id: 'r1', permissionId: 'perm-1', editState: 'designedUserCanEdit',
  })
  w.grants.set('perm-1', { allow: opts.allow, createdBy: 'u-admin', strategies: opts.strategies })
  return w
}

async function may(svc: OctoAuthzIoService, objectID: string, action: number): Promise<boolean> {
  const res = await svc.allowed({ objectID, actions: [action] })
  return res[0]!.allowed
}

describe('OctoAuthzIoService — strategies are honoured, not just stored (WS-PROT-8)', () => {
  it('DENIES an action whose strategy demands a higher role than the caller has', async () => {
    // Bob is on the allow-list (Editor) but Sort demands Owner.
    const { svc } = wireStrategy({
      uid: 'u-bob', role: 'writer', allow: ['u-bob'],
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    expect(await may(svc, 'perm-1', ACTION_SORT)).toBe(false)
  })

  it('ALLOWS it once the strategy only demands Editor and the caller is granted', async () => {
    const { svc } = wireStrategy({
      uid: 'u-bob', role: 'writer', allow: ['u-bob'],
      strategies: [{ action: ACTION_SORT, role: ROLE_EDITOR }],
    })
    expect(await may(svc, 'perm-1', ACTION_SORT)).toBe(true)
  })

  it('DENIES an Editor-level action to someone NOT on the allow-list', async () => {
    const { svc } = wireStrategy({
      uid: 'u-bob', role: 'writer', allow: [],
      strategies: [{ action: ACTION_FILTER, role: ROLE_EDITOR }],
    })
    expect(await may(svc, 'perm-1', ACTION_FILTER)).toBe(false)
  })

  it('DENIES a Reader-level row to someone the allow-list excludes (reversed — this WAS the bug)', async () => {
    // This assertion used to read `.toBe(true)`, under the name "ALLOWS a Reader-level action to
    // anyone, granted or not". That is not a feature — it is the P1-3 widening hole written down as
    // though it were intended. `role: ROLE_READER` is what Univer stores for an ENABLED toggle on a
    // Reader-visible action; it means "this action is not further restricted", NOT "this action is
    // open to people who may not edit the range at all". A restriction control must never be the way
    // in. Kept as an explicit reversal rather than deleted, so the history of the decision survives.
    const { svc } = wireStrategy({
      uid: 'u-nobody', role: 'writer', allow: [],
      strategies: [{ action: ACTION_FILTER, role: ROLE_READER }],
    })
    expect(await may(svc, 'perm-1', ACTION_FILTER)).toBe(false)
  })

  it('ALLOWS that same Reader-level row to someone the allow-list includes', async () => {
    // The other half of the pair: a permissive row does not COST a permitted editor anything.
    const { svc } = wireStrategy({
      uid: 'u-bob', role: 'writer', allow: ['u-bob'],
      strategies: [{ action: ACTION_FILTER, role: ROLE_READER }],
    })
    expect(await may(svc, 'perm-1', ACTION_FILTER)).toBe(true)
  })

  it('a strategy makes its action guarded even though it is NOT in GUARDED_ACTIONS', async () => {
    // The regression this whole block exists for. Sort/Filter/SetCellStyle are outside the base set;
    // without the strategy-aware check they returned allowed before any rule was consulted.
    const { svc } = wireStrategy({
      uid: 'u-bob', role: 'writer', allow: [],
      strategies: [{ action: ACTION_SET_CELL_STYLE, role: ROLE_OWNER }],
    })
    expect(await may(svc, 'perm-1', ACTION_SET_CELL_STYLE)).toBe(false)
  })

  it('leaves UNCONFIGURED actions alone — no toggle means no new restriction', async () => {
    const { svc } = wireStrategy({
      uid: 'u-bob', role: 'writer', allow: [],
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    // Filter has no row, so it is not guarded and stays allowed.
    expect(await may(svc, 'perm-1', ACTION_FILTER)).toBe(true)
  })

  it('an admin is unaffected by any strategy', async () => {
    const { svc } = wireStrategy({
      uid: 'u-admin', role: 'admin', allow: [],
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    expect(await may(svc, 'perm-1', ACTION_SORT)).toBe(true)
  })

  it('a strategy does NOT loosen the base Edit rule', async () => {
    // Editing still needs the allow-list; a permissive Sort row must not leak into Edit.
    const { svc } = wireStrategy({
      uid: 'u-bob', role: 'writer', allow: [],
      strategies: [{ action: ACTION_SORT, role: ROLE_READER }],
    })
    expect(await may(svc, 'perm-1', ACTION_EDIT)).toBe(false)
  })
})

/**
 * WS-PROT-8d — the strategy branch, enumerated as a MATRIX rather than along the shape of the code.
 *
 * The previous strategies suite was written by walking the implementation: every branch was reached,
 * so coverage looked complete, yet a `role: ROLE_READER` row on the QUERIED action was never combined
 * with "caller not on the allow-list" — and that single combination inverted the whole layer. The old
 * `(onAllowList ? ROLE_EDITOR : ROLE_READER) >= strategy.role` made `0 >= 0` true, so a row that is
 * supposed to RESTRICT an action handed edit access to every peer in the range instead. The nearest
 * old test seeded the row on a DIFFERENT action, so `find()` missed and the line was never evaluated.
 *
 * So this table crosses the four dimensions that actually meet in that decision — allow-list
 * membership × editState × strategy role × whether the row targets the queried action — instead of
 * asserting one point per code path. Combinations, not branches.
 */
describe('OctoAuthzIoService — strategies are strictly SUBTRACTIVE (WS-PROT-8d)', () => {
  /** Univer emits `role: Editor` for an ENABLED toggle and `role: Owner` for a disabled one. */
  const CASES: Array<{
    what: string
    onList: boolean
    editState: string
    /** undefined = no row for the queried action. */
    role?: number
    /** false = the row targets a different action, so it must not apply. */
    sameAction?: boolean
    creator?: boolean
    expect: boolean
  }> = [
    // ── The regression this suite exists for: a Reader row must NEVER admit a non-member. ──
    { what: 'not on list + Reader row on the queried action', onList: false, editState: 'designedUserCanEdit', role: ROLE_READER, expect: false },
    { what: 'not on list + Editor row on the queried action', onList: false, editState: 'designedUserCanEdit', role: ROLE_EDITOR, expect: false },
    { what: 'not on list + Owner row on the queried action', onList: false, editState: 'designedUserCanEdit', role: ROLE_OWNER, expect: false },
    // NOT a hole, and deliberately pinned as ALLOW so the next reader does not "fix" it by accident:
    // an action with no configured row is outside this layer entirely. Sort/Filter/… are not in
    // GUARDED_ACTIONS, and Univer's own dialog initialises every toggle to ENABLED, so "no row" means
    // "the admin never restricted this", not "deny by default". The cell writes such an action
    // performs are still gated by ACTION_EDIT. Whether an unconfigured action SHOULD be restricted
    // for a non-member is a product question, not something to settle inside this branch.
    { what: 'not on list + no row at all (unconfigured action is out of scope)', onList: false, editState: 'designedUserCanEdit', expect: true },
    { what: 'not on list + row on a DIFFERENT action (does not apply)', onList: false, editState: 'designedUserCanEdit', role: ROLE_READER, sameAction: false, expect: true },

    // ── A member keeps access unless the row demands more than Editor. ──
    { what: 'on list + Reader row (permissive) on the queried action', onList: true, editState: 'designedUserCanEdit', role: ROLE_READER, expect: true },
    { what: 'on list + Editor row (enabled toggle)', onList: true, editState: 'designedUserCanEdit', role: ROLE_EDITOR, expect: true },
    { what: 'on list + Owner row (disabled toggle) DENIES', onList: true, editState: 'designedUserCanEdit', role: ROLE_OWNER, expect: false },
    { what: 'on list + no row at all', onList: true, editState: 'designedUserCanEdit', expect: true },
    { what: 'on list + row on a DIFFERENT action stays allowed', onList: true, editState: 'designedUserCanEdit', role: ROLE_OWNER, sameAction: false, expect: true },

    // ── 仅我可以编辑 crossed with every strategy role. The creator must survive a permissive row, and
    //    an ordinary member must not be let back in by one. The bug the reviewer's one-line fix
    //    (`onAllowList && …`) would have introduced is the FIRST row here: the creator is not
    //    necessarily on the allow-list, so gating on membership alone locks the owner out of his own
    //    rule the moment any toggle is configured.
    { what: 'OnlyMe creator + Reader row keeps access', onList: false, editState: 'onlyMe', creator: true, role: ROLE_READER, expect: true },
    { what: 'OnlyMe creator + Editor row keeps access', onList: false, editState: 'onlyMe', creator: true, role: ROLE_EDITOR, expect: true },
    { what: 'OnlyMe creator + Owner row is still restricted by it', onList: false, editState: 'onlyMe', creator: true, role: ROLE_OWNER, expect: false },
    { what: 'OnlyMe creator + no row keeps access', onList: false, editState: 'onlyMe', creator: true, expect: true },
    { what: 'OnlyMe non-creator ON the list + Reader row still DENIED', onList: true, editState: 'onlyMe', role: ROLE_READER, expect: false },
    // Same "unconfigured action" carve-out as above — reaches the early return before OnlyMe is read.
    { what: 'OnlyMe non-creator ON the list + no row (unconfigured action)', onList: true, editState: 'onlyMe', expect: true },
    { what: 'OnlyMe non-creator not on list + Reader row DENIED', onList: false, editState: 'onlyMe', role: ROLE_READER, expect: false },
  ]

  for (const c of CASES) {
    it(`${c.expect ? 'ALLOWS' : 'DENIES'} — ${c.what}`, async () => {
      const ydoc = new Y.Doc()
      setProtectionAuthzContext({ ydoc, uid: 'u-bob', role: () => 'writer' as Role })
      const svc = new OctoAuthzIoService()
      ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
        kind: 'r', id: 'r1', permissionId: 'perm-1', editState: c.editState,
      })
      ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', {
        allow: c.onList ? ['u-bob'] : [],
        createdBy: c.creator ? 'u-bob' : 'u-admin',
        ...(c.role === undefined
          ? {}
          : { strategies: [{ action: c.sameAction === false ? ACTION_FILTER : ACTION_SORT, role: c.role }] }),
      })
      expect(await may(svc, 'perm-1', ACTION_SORT)).toBe(c.expect)
    })
  }

  it('the same subtractive rule holds for ACTION_EDIT, which Univer also asks about', async () => {
    // ACTION_EDIT is in GUARDED_ACTIONS, so it reaches the strategy branch by a different route than
    // Sort does (which is guarded only BECAUSE a row exists). Both must land on the same answer.
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: 'u-bob', role: () => 'writer' as Role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
      kind: 'r', id: 'r1', permissionId: 'perm-1', editState: 'designedUserCanEdit',
    })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-1', {
      allow: [], createdBy: 'u-admin', strategies: [{ action: ACTION_EDIT, role: ROLE_READER }],
    })
    expect(await may(svc, 'perm-1', ACTION_EDIT)).toBe(false)
  })
})

/**
 * WS-PROT-8e — `create()` is the path 「更改工作表权限」 actually uses on FIRST configuration, and it
 * used to drop `strategies` on the floor.
 *
 * From `sheets-ui@0.25.1`, `handleChangeActionPermission` mints the object when there is no point rule
 * yet: `create({ objectType, worksheetObject: { unitID, collaborators, name, strategies: actions } })`,
 * and only takes the `update()` branch when `pointRule?.permissionId` already exists. The point rule
 * lives in `WorksheetProtectionPointModel`, which binding.ts does not replicate — so on a fresh sheet,
 * and again after every reload, the toggles go through `create()`.
 *
 * With `create()` ignoring the field, the whole feature was a no-op with a UI: an admin switched a
 * toggle off, `create()` stored `allow`/`createdBy` only, Univer immediately re-queried all fourteen
 * point actions and `allowedFor` returned true for every one of them (none is in GUARDED_ACTIONS and
 * no stored row made them guarded), and on reopen `list()` returned `[]` so the dialog rendered zero
 * rows. Configured, displayed, discarded — the exact failure shape this whole PR exists to remove.
 */
describe('OctoAuthzIoService — create() persists strategies (WS-PROT-8e)', () => {
  it('stores strategies handed to create() on the worksheetObject (the real Univer shape)', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({
      objectType: 2,
      worksheetObject: {
        collaborators: [],
        strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
      },
    } as never)
    expect(grants.get(objectID)!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('stores strategies handed to create() on the selectRangeObject', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({
      selectRangeObject: {
        collaborators: [],
        strategies: [{ action: ACTION_FILTER, role: ROLE_EDITOR }],
      },
    } as never)
    expect(grants.get(objectID)!.strategies).toEqual([{ action: ACTION_FILTER, role: ROLE_EDITOR }])
  })

  it('list() renders back what create() just stored (no empty dialog on reopen)', async () => {
    const { svc } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({
      worksheetObject: { collaborators: [], strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }] },
    } as never)
    const [entry] = (await svc.list({ objectIDs: [objectID] })) as Array<{ strategies: unknown }>
    expect(entry!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('ENFORCES a toggle configured at create() time — the end-to-end assertion', async () => {
    // The one that matters: storing and rendering are worthless if allowedFor still says yes. Bob is
    // a permitted editor of the range; the admin disabled Sort (Univer sends role: Owner for that).
    const { svc, ydoc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({
      worksheetObject: {
        collaborators: [
          { id: 'u-bob', role: ROLE_EDITOR, subject: { userID: 'u-bob', name: 'Bob', avatar: '', anonymous: false, canBindAnonymous: false } },
        ],
        strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
      },
    } as never)
    ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!w:', {
      kind: 'w', permissionId: objectID, editState: 'designedUserCanEdit',
    })
    expect(grants.get(objectID)!.allow).toEqual(['u-bob'])

    // Re-resolve as Bob, a non-admin who IS on the allow-list.
    clearProtectionAuthzContext()
    setProtectionAuthzContext({ ydoc, uid: 'u-bob', role: () => 'writer' as Role })
    const bob = new OctoAuthzIoService()
    expect(await may(bob, objectID, ACTION_EDIT)).toBe(true) // may edit the range...
    expect(await may(bob, objectID, ACTION_SORT)).toBe(false) // ...but the toggle holds
  })

  it('writes NO strategies key when create() carries none (absent stays absent)', async () => {
    // Must not invent an empty array: `[]` and "never configured" are different states downstream,
    // and an invented `[]` would make every unconfigured action look explicitly unrestricted.
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({ selectRangeObject: { collaborators: [] } })
    expect(grants.get(objectID)).toEqual({ allow: [], createdBy: 'u-admin' })
    expect('strategies' in grants.get(objectID)!).toBe(false)
  })

  it('drops malformed rows handed to create() rather than trusting them', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    const objectID = await svc.create({
      worksheetObject: {
        collaborators: [],
        strategies: [
          { action: ACTION_SORT, role: ROLE_OWNER },
          { action: 'nope', role: ROLE_OWNER },
          { role: ROLE_OWNER },
          null,
          17,
        ],
      },
    } as never)
    expect(grants.get(objectID)!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('still refuses a non-admin even when the payload carries strategies', async () => {
    // The admin gate must not be reachable around by adding a field.
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    await expect(
      svc.create({
        worksheetObject: { collaborators: [], strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }] },
      } as never),
    ).rejects.toThrow(/protection_admin_only/)
    expect(grants.size).toBe(0)
  })
})

describe('OctoAuthzIoService — strategies survive the round trip (WS-PROT-8b)', () => {
  it('list() returns the stored rows so the dialog can render them', async () => {
    const { svc } = wireStrategy({
      uid: 'u-admin', role: 'admin', allow: [],
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    const [entry] = (await svc.list({ objectIDs: ['perm-1'], unitID: 'unit-1' })) as Array<{
      strategies: Array<{ action: number; role: number }>
    }>
    expect(entry!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('update() persists toggles sent NESTED, the shape the panel save path uses', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', { allow: [], createdBy: 'u-admin' })
    await svc.update({
      objectID: 'perm-1',
      collaborators: {
        collaborators: [],
        strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
      } as never,
    })
    expect(grants.get('perm-1')!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('a roster-only save does NOT wipe previously configured toggles', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', {
      allow: [], createdBy: 'u-admin',
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    await svc.update({ objectID: 'perm-1', collaborators: [{ id: 'u-bob', role: ROLE_EDITOR }] })
    expect(grants.get('perm-1')!.allow).toEqual(['u-bob'])
    expect(grants.get('perm-1')!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('a roster save carrying Univer literal `strategies: []` does NOT wipe the toggles', async () => {
    // The shape that actually arrives, and the one the test above misses. `sheets-ui@0.25.1`'s
    // roster-save path sends `update({ objectID, strategies: [], scope, collaborators: { collaborators } })`
    // — a literal empty array as filler, NOT a request to clear the toggles. Testing
    // `nextStrategies.length > 0` therefore read that filler as "clear all" and dropped every stored
    // row on an ordinary 「添加人员」 save.
    //
    // A genuine "clear" cannot arrive this way: `handleChangeActionPermission` builds its rows from
    // `Object.keys(permissionMap)`, which is always the full fourteen, so `[]` is only ever filler.
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', {
      allow: [], createdBy: 'u-admin',
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    await svc.update({
      objectID: 'perm-1',
      strategies: [],
      collaborators: { collaborators: [{ id: 'u-bob', role: ROLE_EDITOR }] },
    } as never)
    expect(grants.get('perm-1')!.allow).toEqual(['u-bob'])
    expect(grants.get('perm-1')!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('putCollaborators with literal `strategies: []` does not wipe them either', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', {
      allow: [], createdBy: 'u-admin',
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    await svc.putCollaborators({
      objectID: 'perm-1',
      strategies: [],
      collaborators: { collaborators: [{ id: 'u-bob', role: ROLE_EDITOR }] },
    } as never)
    expect(grants.get('perm-1')!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('the collaborator add/remove calls preserve the toggles (mergeAllow path)', async () => {
    // createCollaborator / updateCollaborator / deleteCollaborator all route through mergeAllow, which
    // rewrote the grant without carrying `prev.strategies`. `sheets-ui@0.25.1` does not call these
    // today, so this was latent — but "latent" is how the last three holes started, and a roster edit
    // silently dropping the admin's per-action restrictions is not a failure anyone would notice.
    for (const call of ['createCollaborator', 'deleteCollaborator'] as const) {
      const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
      grants.set('perm-1', {
        allow: ['u-carol'], createdBy: 'u-admin',
        strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
      })
      await svc[call]({
        objectID: 'perm-1',
        collaborators: [{ id: 'u-carol', role: ROLE_EDITOR }],
      } as never)
      expect(grants.get('perm-1')!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
    }
  })

  it('putCollaborators does not wipe them either', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', {
      allow: ['u-old'], createdBy: 'u-admin',
      strategies: [{ action: ACTION_FILTER, role: ROLE_EDITOR }],
    })
    await svc.putCollaborators({ objectID: 'perm-1', collaborators: [{ id: 'u-new', role: ROLE_EDITOR }] })
    expect(grants.get('perm-1')!.strategies).toEqual([{ action: ACTION_FILTER, role: ROLE_EDITOR }])
  })

  it('drops malformed strategy rows rather than trusting them', async () => {
    const { svc, grants } = wire({ uid: 'u-admin', role: 'admin' })
    grants.set('perm-1', {
      allow: [], createdBy: 'u-admin',
      strategies: [{ action: 'x', role: 1 }, { action: ACTION_SORT, role: ROLE_OWNER }] as never,
    })
    const [entry] = (await svc.list({ objectIDs: ['perm-1'] })) as Array<{ strategies: unknown[] }>
    expect(entry!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })

  it('a non-admin cannot change toggles', async () => {
    const { svc, grants } = wire({ uid: 'u-bob', role: 'writer' })
    grants.set('perm-1', { allow: ['u-bob'], strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }] })
    await svc.update({
      objectID: 'perm-1',
      collaborators: { collaborators: [], strategies: [{ action: ACTION_SORT, role: ROLE_READER }] } as never,
    })
    expect(grants.get('perm-1')!.strategies).toEqual([{ action: ACTION_SORT, role: ROLE_OWNER }])
  })
})

// WS-PROT-8c — a strategy row must not become a BACK DOOR around the two coarser locks.
//
// `strategies` narrows what a permitted editor may do. It is the FINE-grained layer, so it can only
// ever subtract. Consulting it before `editState === OnlyMe` (or before the admin-only carve-out for
// DELETE / MANAGE_COLLABORATOR) inverts that: because a row with `role: ROLE_READER` is satisfied by
// literally everyone (`ROLE_READER >= ROLE_READER`), one such row would hand an evicted user their
// access straight back — a widening dressed up as a restriction.
//
// The existing WS-PROT-8 suite never caught this: its `wireStrategy` helper hard-codes
// `editState: 'designedUserCanEdit'`, so no test ever put a strategy row and OnlyMe in the same
// scenario. Same shape as every other fail-open in this feature — the guard exists, the combination
// that defeats it was simply never exercised.
// ---------------------------------------------------------------------------
describe('OctoAuthzIoService — strategies cannot widen past the coarser locks (WS-PROT-8c)', () => {
  /** Rule + grant + strategies, with editState under the caller's control. */
  function wireStrategyState(opts: {
    uid: string
    role: Role
    allow: string[]
    editState: string
    strategies: Array<{ action: number; role: number }>
    createdBy?: string
  }) {
    const w = wire({ uid: opts.uid, role: opts.role })
    w.ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
      kind: 'r', id: 'r1', permissionId: 'perm-1', editState: opts.editState,
    })
    w.grants.set('perm-1', {
      allow: opts.allow,
      createdBy: opts.createdBy ?? 'u-admin',
      strategies: opts.strategies,
    })
    return w
  }

  it('OnlyMe still DENIES an evicted editor even when a permissive strategy row exists', async () => {
    // Bob is on the allow-list, but the rule is 仅我可以编辑 and Bob did not create it. The
    // `role: ROLE_READER` row is satisfied by everyone; it must not resurrect his edit access.
    const { svc } = wireStrategyState({
      uid: 'u-bob', role: 'writer', allow: ['u-bob'],
      editState: EDIT_STATE_ONLY_ME, createdBy: 'u-admin',
      strategies: [{ action: ACTION_EDIT, role: ROLE_READER }],
    })
    expect(await may(svc, 'perm-1', ACTION_EDIT)).toBe(false)
  })

  it('OnlyMe still ALLOWS the creator when a strategy row is present', async () => {
    // The narrowing layer must not lock the rule's owner out of his own range either.
    const { svc } = wireStrategyState({
      uid: 'u-admin', role: 'writer', allow: [],
      editState: EDIT_STATE_ONLY_ME, createdBy: 'u-admin',
      strategies: [{ action: ACTION_EDIT, role: ROLE_READER }],
    })
    expect(await may(svc, 'perm-1', ACTION_EDIT)).toBe(true)
  })

  it('a permissive strategy row cannot hand a non-admin DELETE or MANAGE_COLLABORATOR', async () => {
    // Administering a rule stays admin-only regardless of toggles: "Bob may edit this range" must
    // never read as "Bob may unprotect it".
    const { svc } = wireStrategyState({
      uid: 'u-bob', role: 'writer', allow: ['u-bob'],
      editState: 'designedUserCanEdit',
      strategies: [
        { action: ACTION_DELETE, role: ROLE_READER },
        { action: ACTION_MANAGE_COLLABORATOR, role: ROLE_READER },
      ],
    })
    expect(await may(svc, 'perm-1', ACTION_DELETE)).toBe(false)
    expect(await may(svc, 'perm-1', ACTION_MANAGE_COLLABORATOR)).toBe(false)
  })

  it('a strategy row still NARROWS a granted editor under the normal edit state', async () => {
    // The feature itself must keep working — this is the case the row is FOR.
    const { svc } = wireStrategyState({
      uid: 'u-bob', role: 'writer', allow: ['u-bob'],
      editState: 'designedUserCanEdit',
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    expect(await may(svc, 'perm-1', ACTION_SORT)).toBe(false)
    expect(await may(svc, 'perm-1', ACTION_EDIT)).toBe(true)
  })
})

/**
 * WS-PROT-11 — 「更改工作表权限」 is an OPERATION MATRIX, not an allow-list.
 *
 * Two Univer features share this one service, and conflating them is how the toggles ended up unable
 * to restrict anyone:
 *
 *   RANGE / WORKSHEET protection asks "WHO may edit this rectangle / sheet" — it has an allow-list,
 *     and 仅我可以编辑 narrows it to the creator.
 *   WORKSHEET PERMISSION POINTS asks "WHICH OPERATIONS are disabled on this sheet" — it has NO
 *     allow-list at all. `handleChangeActionPermission` emits `role: Editor` for an enabled toggle and
 *     `role: Owner` for a disabled one, and Univer compares that against the CALLER's role.
 *
 * The unified `mayEditHere && ROLE_EDITOR >= strategy.role` treated a point rule as if it had a
 * roster. The dialog seeds its collaborators from `listCollaborators({ objectID: unitId })` — the
 * WORKBOOK id, for which no grant exists — so every member comes back Reader, `uidsToGrant` drops
 * them all, and the stored grant is `allow: []`. `mayEditHere` is then false for everyone, so once
 * replication works the dialog would lock the ENTIRE worksheet for every non-admin, including Copy —
 * the opposite of the two toggles the admin actually switched off.
 *
 * A point rule is identified by its own key kind (`${logicalId}!p:`), replicated by binding.ts.
 */
describe('OctoAuthzIoService — worksheet permission POINTS are role-compared, not roster-gated (WS-PROT-11)', () => {
  /** One point rule for `default`, plus the grant carrying the operation matrix. */
  function wirePoint(opts: {
    uid: string
    role: Role
    strategies: Array<{ action: number; role: number }>
    allow?: string[]
  }) {
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: opts.uid, role: () => opts.role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap(SHEET_PERMISSION_POINTS_FIELD).set('default', { permissionId: 'perm-p' })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-p', {
      // Deliberately EMPTY: this is what the dialog really stores, and the point of the test is that
      // it must not matter. See the header.
      allow: opts.allow ?? [],
      createdBy: 'u-admin',
      strategies: opts.strategies,
    })
    return { svc, ydoc }
  }

  it('ALLOWS an enabled (Editor) row for a non-admin who is on NO allow-list', async () => {
    const { svc } = wirePoint({
      uid: 'u-bob', role: 'writer',
      strategies: [{ action: ACTION_SORT, role: ROLE_EDITOR }],
    })
    expect(await may(svc, 'perm-p', ACTION_SORT)).toBe(true)
  })

  it('DENIES a disabled (Owner) row for that same non-admin', async () => {
    const { svc } = wirePoint({
      uid: 'u-bob', role: 'writer',
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    expect(await may(svc, 'perm-p', ACTION_SORT)).toBe(false)
  })

  it('answers per action — one disabled toggle does not disable the others', async () => {
    // The bug shape this replaces: `allow: []` made mayEditHere false, so EVERY point action was
    // denied at once. An admin switching off 「插入行」 must not also switch off Filter.
    const { svc } = wirePoint({
      uid: 'u-bob', role: 'writer',
      strategies: [
        { action: ACTION_SORT, role: ROLE_OWNER },
        { action: ACTION_FILTER, role: ROLE_EDITOR },
      ],
    })
    expect(await may(svc, 'perm-p', ACTION_SORT)).toBe(false)
    expect(await may(svc, 'perm-p', ACTION_FILTER)).toBe(true)
  })

  it('ALLOWS an action with no row at all (unconfigured stays unrestricted)', async () => {
    const { svc } = wirePoint({
      uid: 'u-bob', role: 'writer',
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    expect(await may(svc, 'perm-p', ACTION_FILTER)).toBe(true)
  })

  it('ALLOWS an admin everything, disabled rows included', async () => {
    const { svc } = wirePoint({
      uid: 'u-admin', role: 'admin',
      strategies: [{ action: ACTION_SORT, role: ROLE_OWNER }],
    })
    expect(await may(svc, 'perm-p', ACTION_SORT)).toBe(true)
  })

  it('does NOT leak point semantics into a RANGE rule (the roster still governs there)', async () => {
    // The discriminator has to be the rule KIND, not "does a strategy row exist". A range rule with
    // an Editor row must still require allow-list membership, or WS-PROT-8d's whole matrix inverts.
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: 'u-bob', role: () => 'writer' as Role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
      kind: 'r', id: 'r1', permissionId: 'perm-r', editState: 'designedUserCanEdit',
    })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-r', {
      allow: [], createdBy: 'u-admin', strategies: [{ action: ACTION_SORT, role: ROLE_EDITOR }],
    })
    expect(await may(svc, 'perm-r', ACTION_SORT)).toBe(false)
  })

  it('still DENIES Delete and ManageCollaborator on a point rule to a non-admin', async () => {
    // Operation-matrix semantics must not become a hole for administering the rule itself.
    const { svc } = wirePoint({ uid: 'u-bob', role: 'writer', strategies: [] })
    expect(await may(svc, 'perm-p', ACTION_DELETE)).toBe(false)
    expect(await may(svc, 'perm-p', ACTION_MANAGE_COLLABORATOR)).toBe(false)
  })

  it('fails CLOSED for a disabled row when the context is unwired', async () => {
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: 'u-bob', role: () => 'writer' as Role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap(SHEET_PERMISSION_POINTS_FIELD).set('default', { permissionId: 'perm-p' })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-p', {
      allow: [], strategies: [{ action: ACTION_EDIT, role: ROLE_OWNER }],
    })
    clearProtectionAuthzContext()
    expect(await may(svc, 'perm-p', ACTION_EDIT)).toBe(false)
  })
})

/**
 * The two ways replicated shared state could WIDEN access rather than narrow it.
 *
 * Both of these arrive over the wire from a peer, so neither can be validated at the write site —
 * the read side has to be the one that refuses. And both were reachable while every existing test
 * stayed green, because the suite only ever wrote well-formed values.
 */
describe('hostile replicated state cannot widen access', () => {
  it('a forged `kind: \'p\'` on a RANGE rule does not buy point (roster-free) semantics', async () => {
    // `sheetProtection` keys are `${logicalId}!${kind}:${ruleId}` and binding.ts only ever writes
    // 'r' / 'w' there. The kind used to be read out of the VALUE BODY, so any peer who could write
    // the doc could set `kind: 'p'` on an ordinary range rule and flip `allowedFor` onto the point
    // branch — which consults no allow-list at all. The rule still replicated as a range rule (the
    // KEY says 'r'), so the panel kept displaying the original roster while the range was open to
    // every writer. Deriving the kind from the key makes the forgery unreachable.
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: 'u-bob', role: () => 'writer' as Role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
      kind: 'p', // ← the forgery; the key still says `!r:`
      id: 'r1',
      permissionId: 'perm-r',
      editState: 'designedUserCanEdit',
    })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-r', {
      allow: [], // Bob is NOT on the roster
      createdBy: 'u-admin',
      strategies: [],
    })
    // Point semantics would have returned true here (no strategy row ⇒ allowed).
    expect(await may(svc, 'perm-r', ACTION_EDIT)).toBe(false)
    // Same for an unconfigured non-base action, which the point branch also waves through.
    expect(await may(svc, 'perm-r', ACTION_SORT)).toBe(true) // unguarded + unconfigured: allowed for all
    // …but a configured restrictive row must still bind, proving we are on the roster path.
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-r', {
      allow: [], createdBy: 'u-admin', strategies: [{ action: ACTION_SORT, role: ROLE_EDITOR }],
    })
    expect(await may(svc, 'perm-r', ACTION_SORT)).toBe(false)
  })

  it('a genuine point rule still gets point semantics (the fix is not a blanket denial)', async () => {
    // Guards the obvious over-correction: keying off the map instead of the body must not break the
    // real point path, which lives in SHEET_PERMISSION_POINTS_FIELD and legitimately has no roster.
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: 'u-bob', role: () => 'writer' as Role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap(SHEET_PERMISSION_POINTS_FIELD).set('default', { permissionId: 'perm-p' })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-p', {
      allow: [], createdBy: 'u-admin', strategies: [{ action: ACTION_SORT, role: ROLE_EDITOR }],
    })
    expect(await may(svc, 'perm-p', ACTION_SORT)).toBe(true)
  })

  it('an out-of-range strategy role is ENFORCED as most-restrictive, not waved through', async () => {
    // The strategy layer is evaluated as `ROLE_EDITOR >= strategy.role`, so a NEGATIVE role makes
    // that true for everybody: a row whose entire purpose is to restrict an action instead handed
    // the action to every peer. Shape validation alone passed it (`typeof -1 === 'number'`), and
    // DROPPING the row is not a fix either — an absent row reads as "unconfigured" and is allowed.
    // So it is clamped to Owner (admin-only) instead.
    for (const badRole of [-1, -Infinity, 1.5, Number.NaN]) {
      const { svc } = wireRange({
        uid: 'u-bob', role: 'writer', allow: ['u-bob'],
        strategies: [{ action: ACTION_SORT, role: badRole }],
      })
      expect(await may(svc, 'perm-r', ACTION_SORT)).toBe(false)
    }
  })

  it('a valid role is left alone by the clamp', async () => {
    // The negative control for the case above: clamping must not turn every configured row into a
    // denial, or the per-action toggles stop working entirely.
    const { svc } = wireRange({
      uid: 'u-bob', role: 'writer', allow: ['u-bob'],
      strategies: [{ action: ACTION_SORT, role: ROLE_EDITOR }],
    })
    expect(await may(svc, 'perm-r', ACTION_SORT)).toBe(true)
  })

  function wireRange(opts: {
    uid: string
    role: Role
    allow: string[]
    strategies: Array<{ action: number; role: number }>
  }) {
    const ydoc = new Y.Doc()
    setProtectionAuthzContext({ ydoc, uid: opts.uid, role: () => opts.role })
    const svc = new OctoAuthzIoService()
    ydoc.getMap(SHEET_PROTECTION_FIELD).set('default!r:r1', {
      kind: 'r', id: 'r1', permissionId: 'perm-r', editState: 'designedUserCanEdit',
    })
    ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD).set('perm-r', {
      allow: opts.allow, createdBy: 'u-admin', strategies: opts.strategies,
    })
    return { svc, ydoc }
  }
})
