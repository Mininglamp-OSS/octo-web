// Shared @-mention data source — the single "根" behind every mention surface
// (doc-body editor, comment composer, sheet). Hosts differ in how they PERSIST a
// mention (tiptap inline node / comment body marker / Univer IMentionIOService),
// but they all resolve candidates and shape them through THIS module so the
// {id,label,type} payload handed to the docs-notify card (octo-server #584,
// DocsCardFields) stays identical across surfaces.
//
// Extracted verbatim from editor/mention.ts (SCHEMA-SPEC §10) so behaviour is
// unchanged; editor/mention.ts now re-uses these exports.

import { fetchAllSpaceMembers } from '../octoweb/index.ts'
import { listDocs } from '../pages/docsApi.ts'

export interface MentionItem {
  id: string
  label: string
  type: 'user' | 'doc'
}

/** Cap each source so a large space / doc list can't render an unbounded popup. */
export const MAX_PER_SOURCE = 8

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

/** Load + merge both mention sources. Failures in either source degrade to an empty list. */
export async function loadMentionItems(spaceId: string): Promise<MentionItem[]> {
  const [members, docs] = await Promise.all([
    spaceId ? fetchAllSpaceMembers(spaceId).catch(() => []) : Promise.resolve([]),
    listDocs({ spaceId: spaceId || undefined, pageSize: 50 })
      .then((r) => r.items)
      .catch(() => []),
  ])
  const users: MentionItem[] = members.map((m) => ({ id: m.uid, label: m.name, type: 'user' }))
  const docItems: MentionItem[] = docs.map((d) => ({
    id: d.docId,
    label: d.title || d.docId,
    type: 'doc',
  }))
  return [...users, ...docItems]
}

/**
 * Filter a loaded item list by query and cap each source independently, so users and docs stay
 * both representable even when one source dominates. Query is matched case-insensitively against
 * the label. This is the shared ranking every surface's suggestion popup uses.
 */
export function filterMentionItems(all: MentionItem[], query: string): MentionItem[] {
  const q = query.toLowerCase().trim()
  const matched = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all
  const users = matched.filter((i) => i.type === 'user').slice(0, MAX_PER_SOURCE)
  const docs = matched.filter((i) => i.type === 'doc').slice(0, MAX_PER_SOURCE)
  return [...users, ...docs]
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

