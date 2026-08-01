// Custom people-picker for the sheet's 保护行列 panel.
//
// Why this exists: Univer's stock "user part" has NO roster of its own — the roster is a host slot.
// Left unfilled, 「添加人员」 opens a permanently EMPTY dialog. `@univerjs/sheets-ui` looks the
// override up in the ComponentManager under `UNIVER_SHEET_PERMISSION_USER_PART`
// (`componentManager.get(key) ?? PermissionDetailUserPart`), so registering that key replaces the
// whole section — see the registration in CollabSheet.ts.
//
// The roster is the SAME source as the 管理成员 panel's 「当前成员」 list: `GET /docs/:docId/members`
// via members/api.ts, with names from `useMemberNames(spaceId)`. One source of truth, so the two
// lists can never disagree about who is on the doc.
//
// SELECTION FLOW — the part that is easy to get wrong (and did, first cut).
// Writing the picked uids straight into our grant map does NOT work while a rule is being CREATED:
// the panel is open before the rule exists, so `permissionId` is still empty and the write has
// nowhere to land (the checkboxes appeared dead). Univer's own creation path reads the selection
// from `SheetPermissionUserManagerService.selectUserList` and hands it to
// `IAuthzIoService.create({ selectRangeObject: { collaborators } })`. So the service is the
// authoritative place to put a selection, and OctoAuthzIoService.create() seeds the grant from it.
//
// For an EXISTING rule the selection is seeded FROM the stored grant on open, and persisted by the
// panel's own save path (OctoAuthzIoService.update) — not eagerly on every tick, so 取消 really cancels.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EditStateEnum,
  SheetPermissionUserManagerService,
  useDependency,
  useObservable,
  type ViewStateEnum,
} from '@univerjs/preset-sheets-core'
import {
  canAdministerProtection,
  getProtectionSpaceId,
  listProtectionMembers,
  readGrantAllow,
  type ProtectionAuthzContext,
} from './protectionAuthz.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { t } from '../octoweb/index.ts'

/** UnitRole.Editor — the role we mark a granted collaborator with. */
const ROLE_EDITOR = 1

export interface ProtectionUserPartProps {
  editState: EditStateEnum
  onEditStateChange: (v: EditStateEnum) => void
  /**
   * Univer passes these two because its stock user-part renders a 「查看权限」 radio pair. We accept
   * them to keep the component's contract with `sheets-ui` intact, and deliberately do NOT render a
   * control for them.
   *
   * Why not: nothing in this codebase ENFORCES a view restriction. `OctoAuthzIoService.allowedFor`
   * returns true for ACTION_VIEW unconditionally — hiding content is the DOC's share scope, not a
   * range rule's job — and the backend companion (octo-docs-backend) gates writes only. So the radio
   * was a DEAD CONTROL: it stored `viewState: 'noOneElseCanView'`, replicated it, showed it ticked
   * on reopen, and every peer could still read every cell. That is worse than absent — an admin who
   * ticks 「其他人不可查看」 walks away believing the range is hidden.
   *
   * Restoring the control is a product decision that has to arrive WITH enforcement, not before it.
   */
  viewState: ViewStateEnum
  onViewStateChange: (v: ViewStateEnum) => void
  permissionId: string
  /**
   * The CollabSheet instance this picker belongs to. Supplied by `makeProtectionUserPart` so every
   * accessor answers from THIS sheet's document instead of whichever context installed last — two
   * sheets can be mounted at once (StrictMode double-mount, route change before destroy) and
   * `setGrantAllow` is a write. Optional so a bare `ProtectionUserPart` (tests, the preset seam)
   * keeps the module-global behaviour. WS-PROT-6g.
   */
  owner?: ProtectionAuthzContext | null
}

/** Shape Univer stores a picked collaborator in (structural — see @univerjs/protocol ICollaborator). */
interface Collaborator {
  id: string
  role: number
  subject: { userID: string; name: string; avatar: string; anonymous: boolean; canBindAnonymous: boolean }
}

function toCollaborator(uid: string, name: string): Collaborator {
  return {
    id: uid,
    role: ROLE_EDITOR,
    subject: { userID: uid, name, avatar: '', anonymous: false, canBindAnonymous: false },
  }
}

/** Univer keys a collaborator by `subject.userID`, falling back to `id` on sparse records. */
function uidOf(c: { id?: string; subject?: { userID?: string } } | null | undefined): string {
  return c?.subject?.userID ?? c?.id ?? ''
}

export function ProtectionUserPart(props: ProtectionUserPartProps): JSX.Element {
  // `viewState` / `onViewStateChange` are intentionally not destructured — see the props doc above.
  const { editState, onEditStateChange, permissionId, owner } = props
  const userSvc = useDependency(SheetPermissionUserManagerService)
  const [members, setMembers] = useState<Array<{ uid: string; name?: string }>>([])
  // `owner` is undefined for a bare render (tests, the preset seam) — the accessors then fall back to
  // the module global, which is the pre-WS-PROT-6g behaviour. `?? null` keeps that default reachable.
  const own = owner ?? null
  const canAdminister = canAdministerProtection(own)
  const names = useMemberNames(getProtectionSpaceId(own))

  // The selection Univer will hand to create() / the save path. Observed, not mirrored locally, so
  // the checkbox state and what Univer commits can never drift apart.
  const selected = (useObservable(userSvc.selectUserList$, userSvc.selectUserList) ??
    []) as Collaborator[]
  const selectedUids = useMemo(() => new Set(selected.map((c) => uidOf(c))), [selected])

  const displayName = useCallback((uid: string) => names.get(uid) || uid, [names])

  useEffect(() => {
    let alive = true
    void listProtectionMembers(own).then((list) => {
      if (alive) setMembers(list)
    })
    return () => {
      alive = false
    }
  }, [own])

  // Publish the candidate pool too: Univer's own 「添加人员」 dialog reads `canEditUserList`, and a
  // stale/empty pool there is the very bug this component replaces.
  useEffect(() => {
    if (members.length === 0) return
    userSvc.setCanEditUserList(
      members.map((m) => toCollaborator(m.uid, displayName(m.uid))) as never,
    )
  }, [members, displayName, userSvc])

  // SEED the panel from the rule that already exists. Univer's stock user-part does exactly this
  // (`listCollaborators(permissionId)` → setSelectUserList + setOldCollaboratorList) and by replacing
  // the whole section we inherited the duty. Skipping it had two consequences, both silent:
  //   1. an existing rule's allow-list was invisible — the panel opened with every box unticked even
  //      though people WERE granted, so 「谁能编辑这块区域」 could not be answered anywhere in the UI;
  //   2. `setOldCollaboratorList` is the baseline Univer diffs against to decide whether to call
  //      update() on save. Left empty, ticking one person read as "the roster is now exactly this
  //      one person" and wiped everyone else.
  // Seeded once per rule. Deliberately NOT gated on the roster: the grant comes from
  // readGrantAllow(), which reads the shared doc and needs no network, while `members` only supplies
  // display names. Gating this on `members.length` made a cosmetic fetch load-bearing for a
  // correctness path — and since listProtectionMembers() swallows fetch errors and returns [], the
  // unseeded window was permanent for that panel session, not transient. Two ways it bit:
  //   A. roster not yet in → panel shows 「暂无可指定的成员」, admin flips a 查看/编辑 radio → Univer
  //      sees oldCollaboratorList=[] with a changed state flag → update({collaborators: []}) →
  //      every grantee on the rule is revoked, with nothing on screen suggesting it;
  //   B. worse, SheetPermissionUserManagerService is a DI singleton: opening rule A (granted alice)
  //      then rule B unseeded left A's list in the service, so saving B wrote `allow: [alice]` —
  //      bob revoked, alice granted on a rule nobody picked her for.
  // `displayName` falls back to the uid and this effect re-runs when `members` lands, so names still
  // resolve on arrival — they just no longer gate the write baseline.
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!permissionId) {
      // A rule being CREATED starts from an empty selection — and must not inherit the previous
      // rule's, which lingers in the service until someone resets it.
      if (seededFor.current !== '') {
        seededFor.current = ''
        userSvc.setSelectUserList([] as never)
        userSvc.setOldCollaboratorList?.([] as never)
      }
      return
    }
    if (seededFor.current === permissionId) return
    seededFor.current = permissionId
    const granted = readGrantAllow(permissionId, own)
    const seed = granted.map((uid) => toCollaborator(uid, displayName(uid)))
    userSvc.setSelectUserList(seed as never)
    // Baseline for Univer's change detection — must match what we just seeded.
    userSvc.setOldCollaboratorList?.(seed as never)
    // Mirror the stock behaviour: a rule that grants people IS a 指定用户 rule, so show it as one.
    //
    // ONLY when the rule does not already say otherwise. `仅我可以编辑` is INFORMATION, and an
    // explicit one — the rule stores `editState: 'onlyMe'` and `allowedFor` reads it as "the
    // allow-list is not consulted, only the creator qualifies". Mirroring unconditionally overrode
    // that on mere PANEL OPEN, which is a silent WIDENING and the worst shape of it:
    //   1. admin opens an OnlyMe rule that still carries a stale allow-list (kept deliberately, so
    //      flipping back to 指定用户 restores the roster rather than losing it);
    //   2. this effect flips the panel to DesignedUserCanEdit before the admin touches anything;
    //   3. Univer's footer (PermissionDetailFooterPart) diffs `editState` against `oldRule` to decide
    //      whether to call update() — the flip alone makes `isSameEditStatus` false, so 确认 writes
    //      `editState: designedUserCanEdit` with those stale grantees now LIVE.
    // The admin sees a panel that reads 指定用户 and assumes it always did. Nothing on screen says
    // access was just widened.
    //
    // A rule with NO editState (legacy: written before the field was replicated) carries no such
    // information, so the grant is still the best evidence available and the mirror stands — that is
    // the case this line exists for. EditStateEnum is a STRING enum ('onlyMe' /
    // 'designedUserCanEdit'), so `!== OnlyMe` genuinely distinguishes "absent" from "explicitly me".
    if (seed.length > 0 && editState !== EditStateEnum.OnlyMe) {
      onEditStateChange(EditStateEnum.DesignedUserCanEdit)
    }
  }, [permissionId, members, displayName, userSvc, onEditStateChange, own, editState])

  const toggle = useCallback(
    (uid: string) => {
      if (!canAdminister) return
      const next = selectedUids.has(uid)
        ? selected.filter((c) => uidOf(c) !== uid)
        : [...selected, toCollaborator(uid, displayName(uid))]
      // The service is the single place a selection lives: Univer reads it when minting the rule
      // (create) and when saving an edited one (update). We deliberately do NOT write the grant here
      // any more — an eager write landed before 确认 and survived 取消, so cancelling a change still
      // changed who could edit. The panel's save path persists it; see OctoAuthzIoService.update().
      userSvc.setSelectUserList(next as never)
    },
    [canAdminister, selected, selectedUids, displayName, userSvc],
  )

  const designated = editState === EditStateEnum.DesignedUserCanEdit
  const sorted = useMemo(
    () => [...members].sort((a, b) => displayName(a.uid).localeCompare(displayName(b.uid), 'zh-Hans-CN')),
    [members, displayName],
  )

  return (
    <div className="octo-prot-user">
      <div className="octo-prot-label">{t('docs.sheet.protect.editPermission')}</div>
      <label className="octo-prot-radio">
        <input
          type="radio"
          checked={editState === EditStateEnum.OnlyMe}
          disabled={!canAdminister}
          onChange={() => onEditStateChange(EditStateEnum.OnlyMe)}
        />
        <span>{t('docs.sheet.protect.onlyMe')}</span>
      </label>
      <label className="octo-prot-radio">
        <input
          type="radio"
          checked={designated}
          disabled={!canAdminister}
          onChange={() => onEditStateChange(EditStateEnum.DesignedUserCanEdit)}
        />
        <span>{t('docs.sheet.protect.designatedUsers')}</span>
      </label>

      {designated && (
        <div className="octo-prot-members">
          {sorted.length === 0 ? (
            <div className="octo-prot-empty">{t('docs.sheet.protect.noMembers')}</div>
          ) : (
            sorted.map((m) => (
              <label key={m.uid} className="octo-prot-member">
                <input
                  type="checkbox"
                  checked={selectedUids.has(m.uid)}
                  disabled={!canAdminister}
                  onChange={() => toggle(m.uid)}
                />
                <span className="octo-prot-member-name">{displayName(m.uid)}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Bind a picker to ONE sheet's authz context.
 *
 * Univer instantiates the registered component itself and passes only its own props, so the owning
 * CollabSheet cannot reach it any other way — the context has to be closed over at registration time.
 * Registering the bare `ProtectionUserPart` left every accessor reading the module global, which
 * during a two-sheet overlap window is a different document than the panel is editing. WS-PROT-6g.
 */
export function makeProtectionUserPart(
  owner: ProtectionAuthzContext,
): (props: ProtectionUserPartProps) => JSX.Element {
  return function BoundProtectionUserPart(props: ProtectionUserPartProps): JSX.Element {
    return <ProtectionUserPart {...props} owner={owner} />
  }
}
