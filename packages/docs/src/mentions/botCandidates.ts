// Which Bots may the current user @-mention IN THIS DOCUMENT?
//
// THE RULE (product decision, final): a Bot is offerable iff BOTH hold
//   (1) the caller can reach it     — the caller CREATED it, or it is shared with them as a friend
//   (2) it can act on this document — the Bot is a doc member with writer+ (canEdit) permission
//
// WHY THIS MODULE EXISTS: the backend already enforces (1) ∧ (2) and refuses to dispatch work to a
// Bot that fails either test. The frontend used to enforce NEITHER — it listed every Bot it could
// find — so a user could pick a Bot that was not a member of the document, wait for the task, and
// only then get `403 forbidden — bot lacks permission`. A candidate the user is not allowed to pick
// must never be rendered; that is the whole point of this file.
//
// WHERE EACH HALF OF THE RULE COMES FROM — both are EXISTING endpoints; nothing here is invented:
//   (1) GET /robot/owned_bots?space_id=  (octoweb fetchOwnedBots) — bots the caller CREATED. The
//       server applies the owner + active + in-this-Space filter, so membership of this list IS the
//       "自己创建" relationship, authoritatively.
//       GET /robot/my_bots?space_id=     (octoweb fetchMyBots)    — the caller's FRIEND-dimension
//       agents (`FROM friend WHERE f.uid = loginUID`), so it can never contain a non-friend agent
//       owned by someone else. Union of the two = exactly the "created by me OR shared by a friend"
//       set, and which list a Bot came from is what labels the relationship in the UI.
//   (2) GET /docs/:docId/members         (members/api.ts listMembers) — the document's own member
//       roster with each member's role. A Bot is a uid like any other member, so its doc permission
//       is simply its row's `role`, tested with the shared canEdit() matrix (roles.ts is CONSUMED,
//       never modified). This is the only permission source; nothing is inferred from the Space.
//
// FAIL CLOSED, ALWAYS. Every path that cannot PROVE both halves yields zero Bots:
//   • role may not mention bots            → none (+ 'no-permission' notice)
//   • role not known yet                   → none (+ 'role-unknown' notice — NOT 'no-permission':
//                                            an unarrived role is not proof the caller lacks rights)
//   • no spaceId (can't enumerate bots)    → none
//   • no docId (can't check doc perms)     → none  ← so a surface that forgets to plumb docId
//                                                   degrades to "no bots", never to "all bots"
//   • listMembers rejects (network / 403)  → none. We must not fall back to the unfiltered list:
//                                            that is exactly the bug this module fixes.

import { canEdit, isRole, type Role } from '../auth/roles.ts'
import { fetchMyBots, fetchOwnedBots, getCurrentUid } from '../octoweb/index.ts'
import { listMembers, type Member } from '../members/api.ts'

/** How the caller came to be allowed to use this Bot — drives the "自己创建 / 好友共享" label. */
export type BotRelation = 'creator' | 'friend'

/** One offerable Bot, already proven to satisfy BOTH halves of the rule. */
export interface BotCandidate {
  uid: string
  name: string
  /** One-line "what it does" copy, when the host supplied one. */
  description?: string
  relation: BotRelation
  /**
   * True ONLY when the host explicitly reported the Bot as not online. An absent activity field
   * (today's common case — see MyBotLite.online) means UNKNOWN and yields `false`, so we never
   * disable a Bot on missing data.
   */
  offline: boolean
}

/**
 * Why no Bot can be offered — each maps to one empty-state line. Rendered INSTEAD of a Bot group,
 * so the user learns why the section is empty rather than assuming the feature is broken.
 */
export type BotNotice =
  /** Role is commenter/reader: mentioning a Bot dispatches work, which needs edit rights. */
  | 'no-permission'
  /**
   * The caller's own role is not known YET (the collab token has not answered). Zero Bots, same as
   * 'no-permission' — but it must NOT be reported as 'no-permission', because that line asserts
   * something about the caller's rights that we cannot know. A document OWNER being told 「当前权限
   * 不能 @Bot」 while their role was still in flight is exactly the bug this value separates out.
   */
  | 'role-unknown'
  /** The caller has no created/friend-shared Bot at all. */
  | 'none-available'
  /** The caller HAS such Bots, but none of them holds writer+ on THIS document. */
  | 'none-with-doc-access'
  /** Doc permissions could not be read, so eligibility is unprovable — fail closed. */
  | 'permission-unknown'

export interface BotCandidateResult {
  bots: BotCandidate[]
  /** Non-null exactly when `bots` is empty and the user is owed an explanation. */
  notice: BotNotice | null
}

export interface ResolveBotCandidatesOptions {
  spaceId: string
  /** The document whose member roster decides half (2). Omitted → fail closed (no Bots). */
  docId?: string
  /** Current doc role of the CALLER. Gates half (1)'s precondition via canMentionBot. */
  role?: Role
  /** Defaults to the logged-in uid; injectable for tests. */
  currentUid?: string
  /** Injectable so a caller can reuse an already-loaded roster (tests / future caching). */
  loadMembers?: (docId: string) => Promise<Member[]>
}

/**
 * May this role @-mention a Bot at all? Mentioning a bot DISPATCHES WORK to it, so it gates on the
 * body-edit capability rather than on commenting: `commenter` / `reader` must not even see a Bot
 * candidate. Thin delegate to the shared matrix — no bespoke permission logic. An UNKNOWN role (the
 * collab token has not answered yet) fails CLOSED.
 */
export function canMentionBot(role: Role | undefined): boolean {
  return role != null && canEdit(role)
}

/** Does this doc-member row grant write access? Unparseable roles fail closed. */
function memberMayWrite(m: Member): boolean {
  return isRole(m.role) && canEdit(m.role)
}

/**
 * Resolve the offerable Bots for one document. Never throws: every source is individually
 * `.catch`ed, and a failure degrades to "no Bots" with an explanatory notice.
 */
export async function resolveBotCandidates(
  opts: ResolveBotCandidatesOptions,
): Promise<BotCandidateResult> {
  // Fail closed on an unknown role, but say so HONESTLY: 'no-permission' is a claim about the
  // caller's rights, and a role that has not arrived yet is not evidence for it. Callers memoise
  // per role (mentions/sourceCache.ts), so this state is transient and recomputes once the role
  // lands — it must never be cached as a verdict.
  if (opts.role == null) return { bots: [], notice: 'role-unknown' }
  if (!canMentionBot(opts.role)) return { bots: [], notice: 'no-permission' }
  if (!opts.spaceId) return { bots: [], notice: 'none-available' }

  const [owned, friends] = await Promise.all([
    fetchOwnedBots(opts.spaceId).catch(() => []),
    fetchMyBots(opts.spaceId).catch(() => []),
  ])

  // Half (1): the reachable set. Owned is authoritative for "自己创建", so it is inserted first and
  // wins a uid collision (a bot you created may ALSO come back from the friend query).
  const reachable = new Map<string, BotCandidate>()
  for (const b of owned) {
    const c: BotCandidate = { uid: b.uid, name: b.name, relation: 'creator', offline: false }
    if (b.description) c.description = b.description
    reachable.set(b.uid, c)
  }
  const me = opts.currentUid ?? safeCurrentUid()
  for (const b of friends) {
    const existing = reachable.get(b.uid)
    if (existing) {
      // Already known as self-created; only enrich the fields owned_bots does not carry.
      if (existing.description == null && b.description) existing.description = b.description
      if (b.online === false) existing.offline = true
      continue
    }
    const c: BotCandidate = {
      uid: b.uid,
      name: b.name,
      // my_bots is friend-dimension, so an entry whose creator is NOT me is friend-shared. An
      // ABSENT creatorUid also reads as friend-shared: that is what the endpoint means, and it is
      // the conservative label (never claims authorship we cannot prove).
      relation: me && b.creatorUid === me ? 'creator' : 'friend',
      offline: b.online === false,
    }
    if (b.description) c.description = b.description
    reachable.set(b.uid, c)
  }

  if (reachable.size === 0) return { bots: [], notice: 'none-available' }

  // Half (2): the document's own roster decides who may actually write here.
  if (!opts.docId) return { bots: [], notice: 'permission-unknown' }
  const load = opts.loadMembers ?? listMembers
  let members: Member[]
  try {
    members = await load(opts.docId)
  } catch {
    // Unprovable ⇒ offer nothing. Falling back to the unfiltered list is the original defect.
    return { bots: [], notice: 'permission-unknown' }
  }
  const writers = new Set(members.filter(memberMayWrite).map((m) => m.uid))

  const bots = [...reachable.values()].filter((b) => writers.has(b.uid))
  if (bots.length === 0) return { bots: [], notice: 'none-with-doc-access' }
  return { bots, notice: null }
}

/** getCurrentUid() reads the host singleton; tolerate its absence (harness / SSR). */
function safeCurrentUid(): string | undefined {
  try {
    return getCurrentUid() || undefined
  } catch {
    return undefined
  }
}
