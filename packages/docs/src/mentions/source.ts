// Shared @-mention data source — the single "根" behind every mention surface
// (doc-body editor, comment composer, sheet). Hosts differ in how they PERSIST a
// mention (tiptap inline node / comment body marker / Univer IMentionIOService),
// but they all resolve candidates and shape them through THIS module so the
// {id,label,type} payload handed to the docs-notify card (octo-server #584,
// DocsCardFields) stays identical across surfaces.
//
// Extracted verbatim from editor/mention.ts (SCHEMA-SPEC §10) so behaviour is
// unchanged; editor/mention.ts now re-uses these exports.

import { type Role } from '../auth/roles.ts'
import { fetchAllSpaceMembers, t } from '../octoweb/index.ts'
import { listDocs } from '../pages/docsApi.ts'
import { getSpaceBotUids } from '../members/botUids.ts'
import { resolveBotCandidates, type BotNotice, type BotRelation } from './botCandidates.ts'

export interface MentionItem {
  id: string
  label: string
  /**
   * CROSS-REPO TOKEN CONTRACT — DO NOT extend this union.
   *
   * A mention is persisted into comment bodies / sheet cells as `@[type:id:label]`, and
   * octo-docs-backend parses the SAME grammar to resolve docs-notify recipients. `type` is
   * therefore a wire value shared by two repos, and MENTION_TOKEN_RE (here and on the backend)
   * only accepts `user|doc`. Introducing a third value (`bot`) would make every new token
   * unreadable to any component not deployed in lockstep: an older client would render the raw
   * `@[bot:…]` text instead of a chip, and an older backend would drop the bot from the notify
   * recipients entirely — a silent, cross-repo breaking change.
   *
   * A Bot IS a uid-addressable account, so it serialises as a plain `user` token and stays
   * backward-compatible on the wire. "Is this a bot?" is carried out-of-band by `isBot` below,
   * which is UI/ranking-only and never persisted.
   */
  type: 'user' | 'doc'
  /**
   * True for an AI/robot candidate. PRESENTATION + RANKING ONLY — never serialised into the
   * `@[…]` token (see `type`), so it is absent when an item is re-read out of a stored body.
   */
  isBot?: boolean
  /**
   * PRESENTATION-ONLY Bot detail, populated only for candidates that came out of the eligibility
   * check (mentions/botCandidates.ts). Like `isBot` these are never serialised and are therefore
   * absent on an item parsed back out of a stored body — never branch on them for anything but
   * rendering the suggestion row.
   */
  botDescription?: string
  /** 'creator' → 自己创建, 'friend' → 好友共享. */
  botRelation?: BotRelation
  /** The host explicitly reported this Bot as not online; the row renders disabled. */
  botOffline?: boolean
}

/** Cap each source so a large space / doc list can't render an unbounded popup. */
export const MAX_PER_SOURCE = 8

/**
 * Re-exported from mentions/botCandidates.ts, which now owns the whole "may this Bot be offered?"
 * decision. Kept here so existing importers of the mention source keep resolving.
 */
export { canMentionBot } from './botCandidates.ts'
export type { BotCandidate, BotNotice, BotRelation } from './botCandidates.ts'

export interface LoadMentionItemsOptions {
  /**
   * Current document role. Bots are only fetched/merged when it permits (canMentionBot);
   * omitted / unknown → no Bot candidates at all.
   */
  role?: Role
  /**
   * The document being commented on. REQUIRED for any Bot to be offered: a Bot's eligibility
   * depends on its permission ON THIS DOCUMENT (see botCandidates.ts). Omitted → zero Bots, with
   * a 'permission-unknown' notice — a surface that forgets to plumb docId degrades to "no bots",
   * never to "every bot".
   */
  docId?: string
  /** Current user uid; defaults to the logged-in user. Injectable for tests. */
  currentUid?: string
}

/** Everything one `@` popup needs: the candidate rows plus why the Bot section may be empty. */
export interface MentionSources {
  items: MentionItem[]
  /**
   * Non-null when NO Bot could be offered and the user is owed an explanation (permission, none
   * created/shared, none with doc access, or permissions unreadable). Null when Bots are present.
   */
  botNotice: BotNotice | null
}

/**
 * Navigate to a document by id, preserving the current space/folder query so the deep-link
 * resolves in the existing split-pane (DocsHome reads `?doc=`). No-op when there's no DOM
 * (tests / SSR) or no id.
 */
export function navigateToDoc(docId: string): void {
  if (typeof window === 'undefined' || !docId) return
  try {
    const q = new URLSearchParams(window.location.search)
    q.set('doc', docId)
    window.location.assign(`/docs?${q.toString()}`)
  } catch {
    // navigation unavailable: ignore (click simply does nothing).
  }
}

/**
 * Load + merge every mention source, and report why the Bot section may be empty.
 *
 * PEOPLE = space members (fetchAllSpaceMembers), HUMANS ONLY. A Bot that happens to be a space
 * member is deliberately DROPPED from this roster: space membership says nothing about whether the
 * Bot may act on THIS document, and offering it was the defect that produced
 * `403 forbidden — bot lacks permission` after the user had already dispatched a task.
 *
 * BOTS come from ONE place now — resolveBotCandidates (mentions/botCandidates.ts) — which admits a
 * Bot only when it is (created by the caller OR friend-shared with them) AND holds writer+ on this
 * document. It fails closed on every unprovable path, so an ineligible Bot cannot appear.
 *
 * DOCS = documents the caller can see (docsApi.listDocs).
 *
 * Failures in any source degrade to an empty list for THAT source, so one dead endpoint can never
 * blank the whole popup.
 */
export async function loadMentionSources(
  spaceId: string,
  opts: LoadMentionItemsOptions = {},
): Promise<MentionSources> {
  const [members, botResult, docs, spaceBotUids] = await Promise.all([
    spaceId ? fetchAllSpaceMembers(spaceId).catch(() => []) : Promise.resolve([]),
    resolveBotCandidates({
      spaceId,
      ...(opts.docId != null ? { docId: opts.docId } : {}),
      ...(opts.role != null ? { role: opts.role } : {}),
      ...(opts.currentUid != null ? { currentUid: opts.currentUid } : {}),
    }),
    listDocs({ spaceId: spaceId || undefined, pageSize: 50 })
      .then((r) => r.items)
      .catch(() => []),
    // The authoritative "which uids in this space are Bots" set. See the note on botLeaked below.
    spaceId ? getSpaceBotUids(spaceId) : Promise.resolve<ReadonlySet<string>>(new Set()),
  ])

  /**
   * Is this "member" actually a Bot, and therefore NOT a 成员-group candidate?
   *
   * `SpaceMemberLite.isBot` comes from the host roster's optional `robot` field, so it is only a
   * hint: a host/deployment that omits `robot` yields `isBot === undefined`, and a bot then walks
   * straight through the humans-only filter and renders as an ordinary person. That is exactly the
   * "the panel still isn't filtered" defect — the Bot section correctly excluded a Bot with no
   * permission on this document, and then the SAME Bot reappeared two rows down under 成员, with no
   * badge, no eligibility check, and a mention that 403s on dispatch.
   *
   * So `isBot` is treated as one of two positive signals and never as proof of humanity:
   *   • the roster explicitly said so (`isBot === true`), or
   *   • the uid is in the space's own bot roster (GET /robot/space_bots — a dedicated endpoint whose
   *     entire contents are bots, so membership is authoritative and needs no `robot` field).
   * getSpaceBotUids never rejects (empty set on failure), which degrades to today's `isBot`-only
   * behaviour rather than blanking the people list.
   */
  const botLeaked = (m: { uid: string; isBot?: boolean }): boolean =>
    m.isBot === true || spaceBotUids.has(m.uid)

  const byUid = new Map<string, MentionItem>()
  for (const m of members) {
    // Humans only — see the note above on why a Bot space-member is not a candidate.
    if (botLeaked(m)) continue
    if (!byUid.has(m.uid)) byUid.set(m.uid, { id: m.uid, label: m.name, type: 'user' })
  }
  // Eligible Bots are appended after the humans, carrying their presentation detail. A uid that is
  // already present as a human cannot occur (the human loop skipped bots), but guard anyway so a
  // mislabelled roster can never yield a duplicate row.
  for (const b of botResult.bots) {
    if (byUid.has(b.uid)) continue
    const item: MentionItem = {
      id: b.uid,
      label: b.name,
      type: 'user',
      isBot: true,
      botRelation: b.relation,
    }
    if (b.description) item.botDescription = b.description
    if (b.offline) item.botOffline = true
    byUid.set(b.uid, item)
  }

  const docItems: MentionItem[] = docs.map((d) => ({
    id: d.docId,
    label: d.title || d.docId,
    type: 'doc',
  }))
  return { items: [...byUid.values(), ...docItems], botNotice: botResult.notice }
}

/**
 * Items-only wrapper over loadMentionSources, for surfaces that render a flat list and have no
 * Bot section to explain (the sheet mention overlay). Prefer loadMentionSources in new code.
 */
export async function loadMentionItems(
  spaceId: string,
  opts: LoadMentionItemsOptions = {},
): Promise<MentionItem[]> {
  const { items } = await loadMentionSources(spaceId, opts)
  return items
}

/**
 * Filter a loaded item list by query and cap each source independently, so humans, bots and docs
 * stay all representable even when one source dominates. Query is matched case-insensitively
 * against the label. This is the shared ranking every surface's suggestion popup uses.
 *
 * Bots get their OWN MAX_PER_SOURCE budget rather than competing with humans for the people quota:
 * a space with more than MAX_PER_SOURCE matching humans would otherwise push every Bot out of the
 * list and make the feature look broken. Order stays humans → bots → docs, so the pre-existing
 * relative order of human and doc candidates is unchanged.
 */
export function filterMentionItems(all: MentionItem[], query: string): MentionItem[] {
  const q = query.toLowerCase().trim()
  const matched = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all
  const users = matched.filter((i) => i.type === 'user' && !i.isBot).slice(0, MAX_PER_SOURCE)
  const bots = matched.filter((i) => i.type === 'user' && i.isBot).slice(0, MAX_PER_SOURCE)
  const docs = matched.filter((i) => i.type === 'doc').slice(0, MAX_PER_SOURCE)
  return [...users, ...bots, ...docs]
}

/** Row text for a mention candidate — shared by every suggestion popup so Bot reads the same way. */
export function mentionItemLabel(item: MentionItem): string {
  if (item.type === 'doc') return `📄 ${item.label}`
  // Bot candidates carry a visible AI badge (same `docs.member.aiTag` wording as MemberPicker).
  return item.isBot ? `🤖 @${item.label} · ${t('docs.member.aiTag')}` : `@${item.label}`
}


// ── Plain-text mention token (comments / sheet cells) ──────────────────────────
//
// Surfaces without a rich document model (comment bodies are `string`; sheet cells are strings)
// carry a mention as an inline token embedded in the text: `@[type:id:label]`. This keeps the
// existing `body: string` API unchanged (no schema migration) while remaining machine-parseable —
// octo-docs-backend can extract the same tokens to resolve notify-card recipients (#584). The
// tiptap doc-body editor uses a real inline node instead, but every surface resolves candidates
// through {id,label,type} so the mention payload stays identical.
//
// `type` and `id` are controlled (no `:`/`]`); `label` is display text sanitised so it never
// contains `]` (which would end the token). A `:` inside the label is fine — it is the last,
// greedy field before `]`.

/** Match one mention token; global + capture groups (type, id, label). */
export const MENTION_TOKEN_RE = /@\[(user|doc):([^:\]]+):([^\]]*)\]/g

/** Serialise a mention item to its inline token. Label is sanitised to stay within the token. */
export function serializeMention(item: MentionItem): string {
  const label = item.label.replace(/[\]]/g, '').trim() || item.id
  return `@[${item.type}:${item.id}:${label}]`
}

/** Extract every mention referenced by a text body, de-duplicated by type+id (order preserved). */
export function extractMentions(text: string): MentionItem[] {
  const out: MentionItem[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    const item: MentionItem = { type: m[1] as MentionItem['type'], id: m[2], label: m[3] }
    const key = `${item.type}:${item.id}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/** A text segment: either a plain string run or a resolved mention token. */
export type MentionSegment = { text: string } | { mention: MentionItem }

/**
 * Split a text body into ordered plain-text runs and mention tokens, for rich rendering.
 * `[{text:'hi '}, {mention:{…}}]`. Callers render each mention as a highlighted span.
 */
export function splitMentionText(text: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  let last = 0
  for (const m of text.matchAll(MENTION_TOKEN_RE)) {
    const start = m.index ?? 0
    if (start > last) segments.push({ text: text.slice(last, start) })
    segments.push({ mention: { type: m[1] as MentionItem['type'], id: m[2], label: m[3] } })
    last = start + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last) })
  return segments
}

