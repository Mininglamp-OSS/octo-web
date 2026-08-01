// Sheet range/worksheet protection — the AUTHORIZATION half.
//
// Why this file exists at all
// ---------------------------
// binding.ts replicates protection RULES ("C5 is protected"). A rule alone is decorative,
// because Univer resolves "may this user edit?" through IAuthzIoService keyed by the rule's
// `permissionId` — and the stock AuthzIoLocalService is:
//   - in-memory only (a Map), so a rule loses its authorization on reload; and
//   - permissive for unknown ids: `allowed()` falls back to `_getRole(Owner) || _getRole(Editor)`,
//     where `_getRole` is literally `userId.startsWith('Owner')`. Since the stock service also
//     invents a random `Owner_<8 hex>` user when nobody sets one, EVERY peer answers "allowed".
// That combination is exactly the reported bug: the peer sees a lock and edits straight through it.
//
// So the grant ("who may edit this protected object") must be replicated and persisted alongside
// the rule. It is permissionId-scoped, not sheet-scoped, hence its own Y.Map rather than a field
// on the rule in binding.ts.
//
// Product decision (boss): protection is ADMIN-ONLY. Only a doc admin may create or change a
// protected range, and only an admin (or an explicitly granted uid) may edit inside one. That
// constraint is what keeps this implementation small — we answer from `admin ∪ allowList` instead
// of reimplementing Univer's role/strategy matrix.
//
// SECURITY BOUNDARY — read before trusting this.
// This is enforcement at the CLIENT. The docs backend stores the Y.Doc as an opaque blob and
// validates only DOCUMENT-level role (reader/writer/admin); it has no per-range check (see
// octo-docs-backend/src/collab/persistence.ts + beforeHandleMessage). A determined `writer` can
// therefore still write a protected cell — or rewrite the grant — by driving Yjs directly. This
// layer stops the UI and honest clients; it is NOT a server-enforced permission. Making it one
// requires moving grants out of the Y.Doc behind a REST endpoint with an admin gate.

import type * as Y from 'yjs'
import type { Role } from '../auth/roles.ts'
import { canManage } from '../auth/roles.ts'
// Rules map field — we read it to tell a PROTECTED object from any other permission point.
import {
  SHEET_PERMISSION_POINTS_FIELD,
  SHEET_PROTECTION_FIELD,
  SHEET_PROTECTION_GRANTS_FIELD,
} from './binding.ts'

// Request/response shapes are declared STRUCTURALLY rather than imported from @univerjs/protocol:
// that package is a transitive dep (it arrives under @univerjs/core), so importing it directly here
// would add an undeclared dependency. binding.ts takes the same approach for Univer internals.
// Only the fields we actually read are modelled; everything else rides through untouched.
interface UniverUser {
  userID: string
  name: string
  avatar: string
  anonymous: boolean
  canBindAnonymous: boolean
}
interface UniverCollaborator {
  id: string
  role: number
  subject?: UniverUser
}
interface AllowedRequest {
  objectID: string
  unitID?: string
  actions: number[]
}
interface CreateRequest {
  objectType?: number
  selectRangeObject?: { collaborators?: UniverCollaborator[]; strategies?: unknown }
  worksheetObject?: { collaborators?: UniverCollaborator[]; strategies?: unknown }
}
interface ListPermPointRequest {
  unitID?: string
  objectType?: number
  objectIDs?: string[]
  /**
   * The actions the caller wants an answer for. MUST be honoured: the panel's rule list looks up
   * `ManageCollaborator` and `Delete` in this array to decide whether to render the edit/delete
   * icons, so answering only [View, Edit] made them permanently absent even for doc admins.
   */
  actions?: number[]
}
interface CollaboratorMutation {
  objectID?: string
  collaboratorID?: string
  /**
   * Univer is inconsistent here: the collaborator calls pass a flat array, while the panel's SAVE
   * path passes `collaborators: { collaborators: [...] }` (see `authzIoService.update` in
   * @univerjs/sheets-ui). Both shapes are accepted — see `collaboratorsOf`.
   */
  collaborators?: UniverCollaborator[] | { collaborators?: UniverCollaborator[] }
}

/**
 * Normalise the two shapes Univer sends a roster in. Returns undefined when the payload carries NO
 * roster at all (a perm-point-only update), which callers must distinguish from an EMPTY roster:
 * the first means "leave the grant alone", the second means "revoke everyone".
 */
function collaboratorsOf(
  payload: CollaboratorMutation['collaborators'],
): UniverCollaborator[] | undefined {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.collaborators)) return payload.collaborators
  return undefined
}

/**
 * Grants: permissionId -> who may edit the object that id protects.
 *
 * The name is owned by binding.ts alongside the other shared field names (and its cross-repo contract
 * with the backend), and re-exported here because this module is what reads and writes the map. Two
 * literals would be two things to keep in step; the backend already has its own copy.
 */
export { SHEET_PROTECTION_GRANTS_FIELD } from './binding.ts'

/**
 * Univer's UnitAction values we care about. Numeric on the wire; see @univerjs/protocol.
 * Everything not listed is treated as a read-ish action and allowed.
 */
/**
 * Univer `EditStateEnum.OnlyMe` on the wire. Compared as a string rather than importing the enum so
 * this module keeps no value-import from @univerjs (see the structural-types note above).
 */
const EDIT_STATE_ONLY_ME = 'onlyMe'

const ACTION_VIEW = 0
const ACTION_EDIT = 1
const ACTION_MANAGE_COLLABORATOR = 2
const ACTION_DELETE = 42

/** UnitRole values (@univerjs/protocol): Reader=0, Editor=1, Owner=2. */
const ROLE_READER = 0
const ROLE_EDITOR = 1
const ROLE_OWNER = 2

/**
 * Actions that a protection rule is meant to withhold.
 *
 * These mirror @univerjs/sheets' own `baseProtectionActions` — the list it queries for BOTH range
 * and worksheet rules (`_initRangePermissionFromSnapshot`, `_initRangePermissionChange`,
 * `_initWorksheetPermissionChange`, `refreshPermission`):
 *
 *     const baseProtectionActions = [UnitAction.Edit, UnitAction.View, UnitAction.ManageCollaborator, UnitAction.Delete]
 *
 * `Delete (42)` MUST be here. Univer feeds the answer into `RangeProtectionPermissionDeleteProtectionPoint`
 * and `WorksheetDeleteProtectionPermission`, which are what gate 「删除保护范围」/「移除工作表保护」.
 * Leaving it out authorized every peer to DELETE a protection rule outright — the whole feature
 * bypassed by removing the lock rather than writing through it. Regression-pinned in the test file.
 *
 * `View (0)` is intentionally listed but never withheld — see the `ACTION_VIEW` early-return in
 * `allowedFor`. Hiding content is the doc's share scope, not a range rule's job.
 *
 * NOT here on purpose: `EditWorksheetCell (15)`, which is `@deprecated` in @univerjs/protocol@0.25.1
 * and appears zero times in @univerjs/sheets@0.25.1 — guarding an action nobody asks about bought
 * nothing while `Delete` went unguarded.
 */
const GUARDED_ACTIONS: ReadonlySet<number> = new Set([
  ACTION_EDIT,
  ACTION_VIEW,
  ACTION_MANAGE_COLLABORATOR,
  ACTION_DELETE,
])

/**
 * One row of the 「更改工作表权限」 dialog: an action plus the MINIMUM UnitRole allowed to perform it.
 * Shape mirrors Univer's own `permissionData.strategies` (AuthzIoLocalService.create/allowed) — Univer
 * both renders and consumes this, so a home-grown shape would render blank rows.
 */
export interface StoredStrategy {
  action: number
  role: number
}

export interface StoredGrant {
  /** octo uids allowed to edit inside this protected object, besides doc admins. */
  allow: string[]
  /** uid of the admin who created the rule. Informational (panel "created by" + audit). */
  createdBy?: string
  /**
   * Per-action minimum role — the 「更改工作表权限」 toggles (sort, filter, insert row, set style…).
   * ABSENT means "never configured": every guarded action then falls back to the allow-list rule,
   * i.e. exactly the behaviour before strategies existed. Only a configured row overrides.
   */
  strategies?: StoredStrategy[]
}

export interface ProtectionAuthzContext {
  /** The shared doc. Grants live in a Y.Map on it, so they persist and replicate with the sheet. */
  ydoc: Y.Doc
  /** This client's REAL octo uid — the thing the stock service replaced with a random id. */
  uid: string
  /** Current doc role, read live (a runtime downgrade must take effect without a reload). */
  role: () => Role
  /** Doc members, for the panel's people picker. Resolved names are best-effort. */
  listMembers?: () => Promise<Array<{ uid: string; name?: string }>>
  /** Space id — the people picker resolves uid → display name against the space member source. */
  spaceId?: string
}

/**
 * Module-level context, set by CollabSheet before Univer starts. Mirrors the existing
 * floatDom/formulaBridge.ts idiom: the service is registered into Univer's DI via `useValue`, so it
 * cannot receive octo-side dependencies through the constructor.
 */
let ctx: ProtectionAuthzContext | null = null

export function setProtectionAuthzContext(next: ProtectionAuthzContext): void {
  ctx = next
}

/**
 * Tear down the context — but ONLY if `owner` is still the live one.
 *
 * The ownership check is load-bearing. Two CollabSheet instances can overlap: React StrictMode
 * double-mounts in dev (SheetView's own comment says so), and a route change can construct the next
 * sheet before the previous one's destroy runs. An unconditional `ctx = null` let the OUTGOING
 * instance wipe the INCOMING one's context, and `allowedFor` then had no role to answer with — which
 * used to mean every protected range in the live sheet silently became editable. Passing the object
 * you installed makes a late teardown a no-op instead of a fail-open.
 */
export function clearProtectionAuthzContext(owner?: ProtectionAuthzContext): void {
  if (owner && ctx !== owner) return
  ctx = null
}

/** Collision-resistant id without depending on crypto.randomUUID (not in every target). */
function newObjectId(): string {
  const bytes = new Uint8Array(12)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function grantsMap(c: ProtectionAuthzContext | null = ctx): Y.Map<StoredGrant> | null {
  return c ? c.ydoc.getMap<StoredGrant>(SHEET_PROTECTION_GRANTS_FIELD) : null
}

function readGrant(objectID: string, c: ProtectionAuthzContext | null = ctx): StoredGrant | null {
  const raw = grantsMap(c)?.get(objectID)
  if (!raw || typeof raw !== 'object') return null
  const allow = Array.isArray(raw.allow) ? raw.allow.filter((u): u is string => typeof u === 'string') : []
  const strategies = pickStrategies(raw.strategies)
  return {
    allow,
    ...(typeof raw.createdBy === 'string' ? { createdBy: raw.createdBy } : {}),
    ...(strategies.length > 0 ? { strategies } : {}),
  }
}

function writeGrant(objectID: string, grant: StoredGrant, c: ProtectionAuthzContext | null = ctx): void {
  grantsMap(c)?.set(objectID, grant)
}

/**
 * Is this objectID actually a PROTECTED object?
 *
 * Load-bearing, and the subtlety that made the whole sheet read-only on the first cut. Univer calls
 * `allowed()` for every permission point it evaluates — workbook-level (edit, copy, print…) and
 * worksheet-level ones too, not just protected ranges. Those objectIDs are Univer's own ids and
 * appear in NO grant we wrote. Treating "no grant record" as "denied" therefore denied editing for
 * the entire workbook, and every cell rendered as protected (WS-PROT-2).
 *
 * So the deny path must be scoped to ids we can positively identify as protection objects:
 *   - a grant we wrote for it, or
 *   - a replicated RULE referencing it as `permissionId` (grant may still be in flight).
 * Anything else is not ours to police — return allowed and let Univer's own logic decide.
 */
/**
 * The kind of protection object an id belongs to. Drives WHICH semantics apply — see allowedFor.
 *   'r' range rule · 'w' whole-worksheet rule · 'p' worksheet permission POINTS (operation matrix)
 *   ''  a grant with no surviving rule; treated as roster-governed, the conservative default.
 */
type ProtectionKind = 'r' | 'w' | 'p' | ''

function findProtectionRule(
  objectID: string,
  c: ProtectionAuthzContext | null = ctx,
): { editState: string; kind: ProtectionKind } | null {
  if (!objectID || !c) return null
  // Rules live in the sibling map owned by binding.ts; a rule can arrive before its grant, and a
  // grant can outlive a deleted rule, so BOTH are evidence that the id is one of ours.
  const rules = c.ydoc.getMap<{ permissionId?: unknown; editState?: unknown; kind?: unknown }>(SHEET_PROTECTION_FIELD)
  for (const [key, value] of rules.entries()) {
    if (value && typeof value === 'object' && value.permissionId === objectID) {
      // Derive the kind from the KEY, never from the value body.
      //
      // `sheetProtection` keys are `${logicalSheetId}!${kind}:${ruleId}` and binding.ts writes only
      // 'r' (range) and 'w' (worksheet) there — point rules live in the sibling map handled below,
      // and applyRemoteProtection() likewise `continue`s on anything that is not 'r'/'w'.
      //
      // Trusting `value.kind` made the value body a PRIVILEGE ESCALATION lever: the map is a plain
      // replicated Y.Map, so any peer who can write the doc could store `kind: 'p'` on an ordinary
      // range rule. That value never reaches a Univer model (the key still says 'r', so replication
      // ignores the field), but `allowedFor` believed it and took the point branch —
      // `return !strategy || ROLE_EDITOR >= strategy.role` — which consults NO allow-list at all.
      // One field flip turned a roster-gated range into "any editor may write here", with the panel
      // still displaying the original roster. Reading the key closes that: the same peer would have
      // to write a `!p:` key, which replication drops, so the rule simply would not exist.
      // Parsed exactly like binding.ts applyRemoteProtection() does, so the two agree by construction.
      const bang = key.indexOf('!')
      const rest = bang < 0 ? '' : key.slice(bang + 1)
      const colon = rest.indexOf(':')
      const marker = colon < 0 ? '' : rest.slice(0, colon)
      // Unknown / absent marker ⇒ '' = ROSTER semantics, the conservative reading (it can only deny
      // more). 'p' is deliberately NOT reachable from this map.
      const kind: ProtectionKind = marker === 'r' || marker === 'w' ? marker : ''
      return { editState: typeof value.editState === 'string' ? value.editState : '', kind }
    }
  }
  // Permission POINTS live in their own map — see SHEET_PERMISSION_POINTS_FIELD for why they are not
  // in `sheetProtection` (the backend would read a point rule as a malformed range rule and lock the
  // whole sheet). Same evidence rule: the id being referenced here proves it is one of ours.
  const points = c.ydoc.getMap<{ permissionId?: unknown }>(SHEET_PERMISSION_POINTS_FIELD)
  for (const value of points.values()) {
    if (value && typeof value === 'object' && value.permissionId === objectID) {
      return { editState: '', kind: 'p' }
    }
  }
  // A grant with no surviving rule: still ours, but we cannot read an editState or kind from
  // anywhere. Roster semantics are the conservative reading — they can only deny more.
  if (grantsMap(c)?.has(objectID)) return { editState: '', kind: '' }
  return null
}

/**
 * Keep only well-formed strategy rows; a malformed row must not silently widen access.
 *
 * `role` is additionally CLAMPED to the known ladder (Reader 0 / Editor 1 / Owner 2). The whole
 * strategy layer is evaluated as `ROLE_EDITOR >= strategy.role`, so a row carrying any role BELOW
 * Reader — `-1`, `NaN`, `-Infinity`, all of which pass `typeof === 'number'` — makes that comparison
 * true for every caller and hands the action to everyone. A row whose only purpose is to RESTRICT an
 * action must never be able to grant it, so an out-of-range role is treated as the most restrictive
 * value (Owner) rather than being dropped: dropping the row means "unconfigured", which
 * `allowedFor` also reads as allowed.
 *
 * NaN is why the check is `Number.isInteger` and not `>= 0 && <= 2`: NaN fails every comparison, so
 * a range test would let it through and `ROLE_EDITOR >= NaN` is false — accidentally safe here, but
 * only by luck, and the reverse comparison elsewhere would not be.
 */
function pickStrategies(raw: unknown): StoredStrategy[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (x): x is StoredStrategy =>
        !!x && typeof x === 'object' &&
        typeof (x as StoredStrategy).action === 'number' &&
        typeof (x as StoredStrategy).role === 'number',
    )
    .map((x) =>
      Number.isInteger(x.role) && x.role >= ROLE_READER && x.role <= ROLE_OWNER
        ? x
        : { ...x, role: ROLE_OWNER },
    )
}

/**
 * Pull `strategies` out of a panel payload. Univer nests the save payload one level in places
 * (the same `{collaborators:{collaborators:[]}}` shape that dropped the roster), so probe both
 * depths rather than assuming flat. Returns null when the payload carries no roster at all, so a
 * perm-point-only update does not read as "clear every toggle".
 */
function strategiesFromPayload(config: unknown): StoredStrategy[] | null {
  const probe = (o: unknown): unknown =>
    o && typeof o === 'object' ? (o as { strategies?: unknown }).strategies : undefined
  const c = config as Record<string, unknown> | null
  const raw = probe(c) ?? probe(c?.collaborators) ?? probe(c?.selectRangeObject) ?? probe(c?.worksheetObject)
  return Array.isArray(raw) ? pickStrategies(raw) : null
}

/**
 * The `strategies` fragment to spread into a grant that is being REWRITTEN — the single place the
 * "keep or replace the toggles" decision lives, so the four rewrite paths cannot drift apart.
 *
 * Every mutation here replaces the whole grant record, so any field not restated is DELETED. That made
 * three separate ways to silently discard an admin's per-action toggles:
 *
 *  - `update()` / `putCollaborators()` tested `incoming.length > 0`, and `sheets-ui@0.25.1`'s
 *    roster-save path sends a literal `strategies: []` as filler next to the roster. So an ordinary
 *    「添加人员」 save read as "clear all toggles". A real clear cannot arrive that way:
 *    `handleChangeActionPermission` builds its rows from `Object.keys(permissionMap)`, always the full
 *    fourteen. Empty therefore means "this payload is not about toggles" — same as absent.
 *  - `mergeAllow()` (createCollaborator / updateCollaborator / deleteCollaborator) never restated the
 *    field at all, so a single add/remove dropped them outright.
 *
 * Absent stays absent: no `strategies` key is written when there is nothing to keep, because `[]` and
 * "never configured" are different answers to `allowedFor`'s "is this action guarded" question.
 */
function keepStrategies(config: unknown, prev: StoredGrant | null | undefined): { strategies?: StoredStrategy[] } {
  const incoming = strategiesFromPayload(config)
  if (incoming && incoming.length > 0) return { strategies: incoming }
  return prev?.strategies && prev.strategies.length > 0 ? { strategies: prev.strategies } : {}
}

/**
 * Collaborator uids to GRANT. Filters on role: Univer's own dialog hands us the whole roster with
 * every unselected member marked `ROLE_READER` (see listCollaborators below), so taking the list
 * verbatim silently promoted every reader to editor — the opposite of protecting the range.
 *
 * Fail closed on a missing/unknown role: only an explicit EDITOR-or-above is granted.
 *
 * NOTE this must NOT be used on the REVOKE path (`deleteCollaborator`): a collaborator being removed
 * may arrive with any role, and filtering there would make revocation silently do nothing.
 */
function uidsToGrant(list: readonly UniverCollaborator[] | undefined): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const c of list) {
    if (typeof c?.role !== 'number' || c.role < ROLE_EDITOR) continue
    const uid = c?.subject?.userID ?? c?.id
    if (typeof uid === 'string' && uid) out.push(uid)
  }
  return out
}

/** Collaborator ids the panel sends us are Univer `ICollaborator.id`; we key grants by octo uid. */
function uidsFromCollaborators(list: readonly UniverCollaborator[] | undefined): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const c of list) {
    const uid = c?.subject?.userID ?? c?.id
    if (typeof uid === 'string' && uid) out.push(uid)
  }
  return out
}

/**
 * Read side for the custom people-picker (ProtectionUserPart). The picker is rendered by UNIVER, so
 * it receives only a `permissionId` — it reaches the octo side through these module-level accessors,
 * the same bridge the service itself uses.
 *
 * Each takes an OPTIONAL owner context, for the same reason OctoAuthzIoService does (WS-PROT-6f):
 * two CollabSheet instances can be mounted at once, and the module global belongs to whichever
 * installed last. Reading it unconditionally cross-wired the picker to the incoming document — most
 * damagingly on `setGrantAllow`, a WRITE. Omitting the argument keeps the global behaviour for the
 * existing call sites and the tests. WS-PROT-6g.
 */
export function readGrantAllow(permissionId: string, c: ProtectionAuthzContext | null = ctx): string[] {
  return readGrant(permissionId, c)?.allow ?? []
}

/** Space id for uid → name resolution in the picker. Empty when unwired. */
export function getProtectionSpaceId(c: ProtectionAuthzContext | null = ctx): string {
  return c?.spaceId ?? ''
}

/** Doc members for the picker. Resolves to [] when unwired or on a fetch error. */
export async function listProtectionMembers(
  c: ProtectionAuthzContext | null = ctx,
): Promise<Array<{ uid: string; name?: string }>> {
  try {
    return (await c?.listMembers?.()) ?? []
  } catch {
    return []
  }
}

/**
 * Replace a protected object's edit allow-list. ADMIN-ONLY, enforced here rather than in the picker
 * so the rule holds no matter which UI calls it (the picker also hides itself for non-admins).
 * Returns whether the write happened.
 */
export function setGrantAllow(
  permissionId: string,
  uids: readonly string[],
  c: ProtectionAuthzContext | null = ctx,
): boolean {
  if (!permissionId || !c) return false
  if (!canManage(c.role())) return false
  const prev = readGrant(permissionId, c)
  writeGrant(permissionId, {
    allow: [...new Set(uids)],
    ...(prev?.createdBy ? { createdBy: prev.createdBy } : { createdBy: c.uid }),
    // A roster save is not a statement about the per-action toggles — carry them across, or one
    // 「添加人员」 confirm through the picker silently un-restricts everything the admin configured.
    // Same omission keepStrategies fixed on the four service-side rewrite paths.
    ...keepStrategies(undefined, prev),
  }, c)
  return true
}

/** Whether this client may administer protection (the picker renders read-only otherwise). */
export function canAdministerProtection(c: ProtectionAuthzContext | null = ctx): boolean {
  return c ? canManage(c.role()) : false
}

/**
 * IAuthzIoService backed by the shared Y.Doc, answering from `admin ∪ allowList`.
 *
 * Registered with `useValue` rather than `useClass`: the stock service's DI metadata does not
 * reliably survive subclassing, and we need none of its dependencies (the current user comes from
 * the octo session, and persistence is the Y.Doc rather than a snapshot resource).
 */
export class OctoAuthzIoService {
  /**
   * The context THIS instance was wired with.
   *
   * Two CollabSheet instances can be mounted at once (StrictMode double-mount, route change before
   * the previous destroy). Reading the module global made the outgoing instance answer from the
   * INCOMING sheet's document: its own permissionIds are absent there, so every protected range in
   * the sheet still on screen unlocked, and a writer → admin transition promoted it as well. Teardown
   * was already hardened against that window (clearProtectionAuthzContext's ownership token);
   * resolving our own context is the install-side half of the same fix. WS-PROT-6f.
   *
   * Falls back to the global when constructed without one, which is how the tests and any
   * pre-existing wiring reach it.
   */
  constructor(private readonly own: ProtectionAuthzContext | null = null) {}

  private get c(): ProtectionAuthzContext | null {
    return this.own ?? ctx
  }

  /** Whether this client may administer protection at all (create/modify rules). */
  private isAdmin(): boolean {
    const c = this.c
    return c ? canManage(c.role()) : false
  }

  /** The strategy row configured for this action on this object, if any. */
  private strategyFor(objectID: string, action: number): StoredStrategy | undefined {
    return readGrant(objectID, this.c)?.strategies?.find((x) => x.action === action)
  }

  private allowedFor(objectID: string, action: number): boolean {
    // View is never withheld: hiding content is the doc's share scope, not a range rule's job.
    if (action === ACTION_VIEW) return true
    const c = this.c
    // GUARDED_ACTIONS is the BASE set Univer always asks about. The 「更改工作表权限」 toggles cover a
    // different range entirely (Sort 17, Filter 18, SetCellStyle 33, …), none of which are in that
    // set — so returning early here made every configured toggle unreachable: stored, displayed, and
    // never consulted. A configured strategy therefore makes its own action guarded.
    if (!GUARDED_ACTIONS.has(action) && !(c && this.strategyFor(objectID, action))) return true
    if (!c) {
      // FAIL CLOSED. This used to return true "rather than brick a whole sheet", which made a
      // wiring regression (or the teardown race above) look exactly like "protection quietly
      // disappeared" — invisible, and the same failure mode this feature exists to remove. Denying
      // guarded actions instead surfaces as "the protected range is locked for everyone", which is
      // annoying but obvious and cannot be mistaken for the feature working.
      // Non-guarded actions already returned true above, so an unwired sheet stays fully editable
      // OUTSIDE protected ranges.
      return false
    }
    if (this.isAdmin()) return true
    // ONLY protection objects are ours to guard. Univer evaluates workbook/worksheet permission
    // points through this same call; denying those would make the whole sheet read-only.
    const rule = findProtectionRule(objectID, c)
    if (!rule) return true
    const grant = readGrant(objectID, c)
    // Fail CLOSED for a known-protected object: no grant record means nobody was granted. This is
    // also the state a peer is in while a grant is still replicating — a brief false deny, never a
    // false allow.
    if (!grant) return false
    // ADMINISTERING a rule is not the same as EDITING inside one. Being on the allow-list buys write
    // access to the cells; it must not buy the ability to delete the rule or re-write its roster.
    // Both are admin-only (admins already returned true above), so deny them for everyone else even
    // when granted — otherwise "I let Bob edit this range" silently also meant "Bob may unprotect it".
    if (action === ACTION_DELETE || action === ACTION_MANAGE_COLLABORATOR) return false
    const strategy = grant.strategies?.find((x) => x.action === action)
    // WORKSHEET PERMISSION POINTS ('p') are an OPERATION MATRIX, not a roster.
    //
    // Two Univer features reach this one method. Range/worksheet protection asks "WHO may edit this
    // rectangle / sheet" and has an allow-list. 「更改工作表权限」 asks "WHICH OPERATIONS are disabled
    // on this sheet" and has no allow-list at all — `handleChangeActionPermission` emits
    // `role: Editor` for an enabled toggle and `role: Owner` for a disabled one, to be compared
    // against the CALLER's role.
    //
    // Judging a point rule with roster semantics is why the toggles could not restrict anyone. The
    // dialog seeds its collaborators from `listCollaborators({ objectID: unitId })` — the WORKBOOK id,
    // which has no grant — so every member comes back Reader, `uidsToGrant` drops them all, and the
    // stored allow-list is empty. Requiring membership then denies EVERY point action to every
    // non-admin, including Copy: the exact opposite of the two toggles the admin switched off.
    //
    // Unconfigured actions stay allowed (Univer's own dialog initialises all fourteen to enabled), and
    // Delete/ManageCollaborator were withheld above so this is not a way to administer the rule.
    if (rule.kind === 'p') return !strategy || ROLE_EDITOR >= strategy.role
    const onAllowList = grant.allow.includes(c.uid)
    // BASE decision first: may this caller edit inside the rule AT ALL? `仅我可以编辑`
    // (EditStateEnum.OnlyMe) means exactly that — the allow-list is NOT consulted, only the rule's
    // creator qualifies, so a previously-granted collaborator cannot keep write access while the panel
    // reads "only I can edit". Everything below can narrow this answer; nothing may widen it.
    const mayEditHere = rule.editState === EDIT_STATE_ONLY_ME
      ? grant.createdBy === c.uid
      : onAllowList
    // A CONFIGURED strategy row narrows the base answer for its own action — that is the point of the
    // per-action toggles: "people who may edit this range may still not sort or filter it".
    //
    // It is an AND with the base answer, never a replacement. The first cut wrote
    // `(onAllowList ? ROLE_EDITOR : ROLE_READER) >= strategy.role`, which for a `role: ROLE_READER`
    // row evaluates `ROLE_READER >= ROLE_READER` — true for LITERALLY EVERYONE. A row whose whole
    // purpose is to restrict an action instead handed that action to every peer in the range, and the
    // comment above it claimed the layer was subtractive. Guarded by the WS-PROT-8d matrix.
    //
    // Gating on `onAllowList` alone (the obvious repair) is also wrong: under `仅我可以编辑` the
    // creator need not be on his own allow-list, so any configured toggle would lock the rule's owner
    // out of it. Hence the base answer rather than list membership. Admins returned true far above, so
    // the strongest role any caller here can hold is Editor.
    if (strategy) return mayEditHere && ROLE_EDITOR >= strategy.role
    return mayEditHere
  }

  async create(config: CreateRequest): Promise<string> {
    // ADMIN GATE — the load-bearing one. Hiding the menu entries (CollabSheet) is presentation; this
    // is the rule that actually holds, because Univer calls create() to mint the permissionId BEFORE
    // it writes the rule. Refusing here aborts the command, so no rule is ever created.
    //
    // Without this a non-admin could open the panel and protect a range: the new grant's allow-list
    // starts empty, so the creator promptly locked THEMSELVES out of the cells they just protected
    // (reported bug — "我不是管理员但能设置权限，设置完我又没法编辑了").
    if (!this.isAdmin()) {
      throw new Error('protection_admin_only: only a document admin may create a protected range')
    }
    const objectID = newObjectId()
    const seed = config.selectRangeObject ?? config.worksheetObject
    // STRATEGIES ON THE CREATE PATH. `create()` is not just "mint an id" — for 「更改工作表权限」 it is
    // the ONLY path that carries the per-action toggles on first configuration, because
    // `handleChangeActionPermission` only reaches `update()` when a point rule with a permissionId
    // already exists, and that model is not replicated so it is absent on every fresh load.
    //
    // Dropping the field here made the entire toggle dialog a no-op that looked like it worked: stored
    // nothing, so Univer's immediate re-query of all fourteen point actions found no guarded row and
    // allowed every one; and `list()` then rendered an empty dialog on reopen. Pinned by WS-PROT-8e.
    //
    // Absent stays absent — an invented `[]` would read downstream as "explicitly unrestricted".
    const strategies = strategiesFromPayload(config)
    const c = this.c
    writeGrant(objectID, {
      allow: uidsToGrant(seed?.collaborators),
      ...(c ? { createdBy: c.uid } : {}),
      ...(strategies && strategies.length > 0 ? { strategies } : {}),
    }, c)
    return objectID
  }

  async allowed(config: AllowedRequest): Promise<Array<{ action: number; allowed: boolean }>> {
    const actions = Array.isArray(config?.actions) ? config.actions : []
    return actions.map((action) => ({ action, allowed: this.allowedFor(config.objectID, action) }))
  }

  async batchAllowed(
    configs: AllowedRequest[],
  ): Promise<Array<{ objectID: string; actions: Array<{ action: number; allowed: boolean }> }>> {
    const out: Array<{ objectID: string; actions: Array<{ action: number; allowed: boolean }> }> = []
    for (const config of configs ?? []) {
      out.push({ objectID: config.objectID, actions: await this.allowed(config) })
    }
    return out
  }

  async list(config: ListPermPointRequest): Promise<unknown[]> {
    const ids: string[] = Array.isArray(config?.objectIDs) ? config.objectIDs : []
    const unitID = config?.unitID ?? ''
    // Answer the actions the CALLER asked about. This used to hard-code [View, Edit]; Univer queries
    // with `baseProtectionActions = [Edit, View, ManageCollaborator, Delete]` and the panel's rule
    // list resolves the manage/delete entries out of this array to decide whether to render 「编辑」/
    // 「删除」 on each rule. A missing entry reads as `allowed === undefined` → falsy → the icons
    // vanished for EVERYONE, admins included, so a rule could be created and never removed.
    const actions =
      Array.isArray(config?.actions) && config.actions.length > 0
        ? config.actions
        : [ACTION_VIEW, ACTION_EDIT, ACTION_MANAGE_COLLABORATOR, ACTION_DELETE]
    return ids.map((objectID) => ({
      objectID,
      unitID,
      objectType: config?.objectType ?? 0,
      // Real strategies, read back from the grant. Returning `[]` made the dialog show Univer's own
      // padding on FIRST open and nothing on reopen, while the toggles an admin set were dropped on
      // save — a dialog that silently discarded its own input.
      strategies: readGrant(objectID, this.c)?.strategies ?? [],
      actions: actions.map((action: number) => ({
        action,
        allowed: this.allowedFor(objectID, action),
      })),
    }))
  }

  async listRoles(): Promise<{ roles: Array<{ name: string; type: number }>; actions: number[] }> {
    return {
      roles: [
        { name: 'reader', type: ROLE_READER },
        { name: 'editor', type: ROLE_EDITOR },
        { name: 'owner', type: ROLE_OWNER },
      ],
      actions: [ACTION_VIEW, ACTION_EDIT, ACTION_MANAGE_COLLABORATOR, ACTION_DELETE],
    }
  }

  async update(config: CollaboratorMutation): Promise<void> {
    // P1-2: this used to take only `objectID` and re-write the grant unchanged — a no-op. Univer's
    // panel-save path can carry the edited roster HERE rather than through the collaborator calls,
    // so dropping it meant an admin's allow-list edit silently vanished: the panel showed the new
    // list, enforcement kept the old one. Same shape as putCollaborators (replace, editors only).
    const objectID = config?.objectID
    if (!objectID) return
    if (!this.isAdmin()) return
    const prev = readGrant(objectID, this.c)
    // The panel's SAVE path sends the roster NESTED (`collaborators: { collaborators: [...] }`),
    // while the collaborator calls send it flat. Testing `Array.isArray` on the outer value
    // therefore rejected the panel's own save — an admin's roster edit on an EXISTING rule was
    // dropped on the floor, which is the exact bug this method was added to fix.
    // Absent roster (undefined) => perm-point-only update; leave the grant untouched.
    const roster = collaboratorsOf(config.collaborators)
    const incoming = strategiesFromPayload(config)
    // Nothing to apply at all => perm-point-only update; leave the grant untouched. A filler `[]`
    // counts as nothing, per keepStrategies.
    if (!roster && !(incoming && incoming.length > 0)) return
    const c = this.c
    writeGrant(objectID, {
      allow: roster ? uidsToGrant(roster) : (prev?.allow ?? []),
      ...(prev?.createdBy ? { createdBy: prev.createdBy } : c ? { createdBy: c.uid } : {}),
      ...keepStrategies(config, prev),
    }, c)
  }

  async listCollaborators(config: { objectID?: string }): Promise<UniverCollaborator[]> {
    const grant = readGrant(config?.objectID ?? '', this.c)
    const granted = new Set(grant?.allow ?? [])
    let members: Array<{ uid: string; name?: string }> = []
    try {
      members = (await this.c?.listMembers?.()) ?? []
    } catch {
      members = []
    }
    // Fall back to the grant itself so an offline/failed member fetch still shows who was granted
    // (the stock service returns [] here, which is the empty "添加人员" dialog).
    if (members.length === 0) members = [...granted].map((uid) => ({ uid }))
    return members.map((m) => ({
      id: m.uid,
      role: granted.has(m.uid) ? ROLE_EDITOR : ROLE_READER,
      subject: {
        userID: m.uid,
        name: m.name ?? m.uid,
        avatar: '',
        anonymous: false,
        canBindAnonymous: false,
      },
    }))
  }

  async createCollaborator(config: CollaboratorMutation): Promise<void> {
    this.mergeAllow(config?.objectID, uidsToGrant(collaboratorsOf(config?.collaborators)), 'add')
  }

  async updateCollaborator(config: CollaboratorMutation): Promise<void> {
    this.mergeAllow(config?.objectID, uidsToGrant(collaboratorsOf(config?.collaborators)), 'add')
  }

  async deleteCollaborator(config: CollaboratorMutation): Promise<void> {
    const uids = uidsFromCollaborators(collaboratorsOf(config?.collaborators))
    if (config?.collaboratorID) uids.push(config.collaboratorID)
    this.mergeAllow(config?.objectID, uids, 'remove')
  }

  async putCollaborators(config: CollaboratorMutation): Promise<void> {
    if (!config?.objectID) return
    if (!this.isAdmin()) return
    const prev = readGrant(config.objectID, this.c)
    const c = this.c
    writeGrant(config.objectID, {
      allow: uidsToGrant(collaboratorsOf(config.collaborators)),
      ...(prev?.createdBy ? { createdBy: prev.createdBy } : c ? { createdBy: c.uid } : {}),
      // A roster replace must not wipe the per-action toggles configured alongside it.
      ...keepStrategies(config, prev),
    }, c)
  }

  /** Only an admin may change who is granted — the whole point of the admin-only decision. */
  private mergeAllow(objectID: string | undefined, uids: string[], mode: 'add' | 'remove'): void {
    if (!objectID || uids.length === 0) return
    if (!this.isAdmin()) return
    const c = this.c
    const prev = readGrant(objectID, c) ?? { allow: [] }
    const set = new Set(prev.allow)
    for (const uid of uids) {
      if (mode === 'add') set.add(uid)
      else set.delete(uid)
    }
    writeGrant(objectID, {
      allow: [...set],
      ...(prev.createdBy ? { createdBy: prev.createdBy } : c ? { createdBy: c.uid } : {}),
      // A single add/remove is not a statement about the per-action toggles — carry them across, or
      // one 「添加人员」 click silently un-restricts everything the admin configured.
      ...keepStrategies(undefined, prev),
    }, c)
  }
}
