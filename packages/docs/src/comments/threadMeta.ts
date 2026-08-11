// Derived, PURE per-thread presentation facts the comment drawer needs (prototype spec §三/§四).
//
// WHY A DEDICATED MODULE: the drawer has to answer three questions that the frozen backend comment
// contract (api.ts) does not answer directly — "is this thread a Bot request?", "what happened to
// its quoted anchor?" and "must it stay on screen even though it is resolved?". Each is a pure
// function of the wire row plus a little live-editor state, so they live here (unit-testable, one
// place to change) instead of being inlined in the panel.
//
// EXPLICIT NON-GOAL: none of this is persisted. The backend has no `anchorState` and no "is bot"
// column, so these are UI-only derivations that degrade gracefully (an unknown bot uid simply
// renders as a human thread) rather than inventing wire fields.

import { extractMentions } from '../mentions/source.ts'
import type { Comment, CommentThread } from './api.ts'

/**
 * Lifecycle of a root comment's quoted anchor (spec §三). Drives the pill shown next to the quote:
 *   active  — quote still matches the live document; no badge.
 *   updated — a Bot rewrote the quoted text on this thread's behalf → 「引用已更新」(green fill).
 *   changed — the quoted text moved/changed under a human edit → 「引用已变化，待确认」(orange fill).
 *   invalid — the anchor no longer resolves at all → 「原引用已失效」(orange fill).
 */
export type AnchorState = 'active' | 'updated' | 'changed' | 'invalid'

/** i18n key (under the `docs.comment.` namespace) for each state's badge, or null for no badge. */
export function anchorStateLabelKey(state: AnchorState): string | null {
  switch (state) {
    case 'updated':
      return 'docs.comment.anchorUpdated'
    case 'changed':
      return 'docs.comment.anchorChanged'
    case 'invalid':
      return 'docs.comment.anchorInvalid'
    default:
      return null
  }
}

/** `updated` reads as success (green fill); `changed`/`invalid` read as review (orange fill). */
export function anchorStateTone(state: AnchorState): 'success' | 'review' | null {
  if (state === 'updated') return 'success'
  if (state === 'changed' || state === 'invalid') return 'review'
  return null
}

export interface AnchorStateInput {
  /** The root carries a stored Yjs anchor (replies and anchorless roots do not). */
  hasAnchor: boolean
  /**
   * The Yjs binding is live, so a null `liveText` genuinely means "orphaned" rather than
   * "the editor has not synced yet". Before this is true we must not accuse an anchor of dying.
   */
  ready: boolean
  /** Current text under the resolved anchor range, or null when the anchor no longer resolves. */
  liveText: string | null
  /** Plain-text snapshot captured when the comment was created. */
  anchorText: string
  /** A Bot successfully applied this thread's request (see `isBotResolvedThread`). */
  botApplied: boolean
}

/** Ignore whitespace-only churn so a reflow does not read as a content change. */
function normalizeAnchorText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Classify a root's anchor.
 *
 * `botApplied` deliberately WINS over every other signal, including a dead anchor. A Bot rewrite
 * frequently replaces the whole quoted span, which collapses both RelativePositions and makes the
 * anchor unresolvable — reporting 「原引用已失效」there would blame the user for the Bot's own
 * (successful) edit. The prototype does the same on its success path, and the product owner's
 * instruction is explicit: after a Bot edit the comment STAYS and reads 「引用已更新」.
 */
export function deriveAnchorState(input: AnchorStateInput): AnchorState {
  if (input.botApplied) return 'updated'
  if (!input.hasAnchor || !input.ready) return 'active'
  if (input.liveText == null) return 'invalid'
  return normalizeAnchorText(input.liveText) === normalizeAnchorText(input.anchorText)
    ? 'active'
    : 'changed'
}

/**
 * Every uid a comment addresses or was written by. A Bot mention serialises as a plain
 * `@[user:<uid>:<name>]` token (see mentions/source.ts — `bot` is deliberately NOT a wire type), so
 * "this comment involves a bot" is a uid-membership question, never a token-type question.
 */
function participantUids(comment: Comment): string[] {
  const uids = [comment.authorUid]
  if (comment.resolvedBy) uids.push(comment.resolvedBy)
  for (const m of extractMentions(comment.body)) {
    if (m.type === 'user') uids.push(m.id)
  }
  return uids
}

/**
 * True when this thread is a Bot thread: the root (or any reply) was written by, addressed to, or
 * resolved by a known bot uid. `botUids` comes from the space's bot roster (members/botUids.ts);
 * when it is empty every thread reads as human, which is the safe default — purple chrome only ever
 * appears where we positively know a Bot is involved (spec 视觉目标 §3).
 */
export function isBotThread(thread: CommentThread, botUids?: ReadonlySet<string>): boolean {
  if (!botUids || botUids.size === 0) return false
  for (const uid of participantUids(thread)) if (botUids.has(uid)) return true
  for (const reply of thread.replies) {
    for (const uid of participantUids(reply)) if (botUids.has(uid)) return true
  }
  return false
}

/**
 * True when a BOT closed this thread — i.e. it ran the request and auto-resolved the comment. This
 * is the "Bot finished" signal the drawer needs for two things: the 「引用已更新」badge, and keeping
 * the thread on screen (see `mergeKeptThreads`).
 */
export function isBotResolvedThread(
  thread: CommentThread,
  botUids?: ReadonlySet<string>,
): boolean {
  if (!thread.resolved || !thread.resolvedBy) return false
  return botUids != null && botUids.has(thread.resolvedBy)
}

/**
 * Splice bot-auto-resolved threads back into the server's list, newest-id order preserved.
 *
 * THE BUG THIS EXISTS TO PREVENT (prototype spec §四.1): a Bot finishes, auto-resolves the comment,
 * and — because the drawer's default filter hides resolved threads — the whole thread vanishes from
 * under the user, leaving only a toast. The prototype has this defect for real (`keep-visible`
 * loses to `thread.hidden !important`). Product owner ruling: the comment STAYS and shows
 * 「引用已更新」.
 *
 * Resolved visibility here is SERVER-side (`includeResolved` is a query param), so a CSS-level fix
 * is not even available to us: once the bot resolves it, the next refresh simply stops returning
 * the row. `kept` is the caller's session-scoped snapshot of such rows; this merges them back by
 * id, and rows the server DOES return always win (they are fresher).
 */
export function mergeKeptThreads(
  serverThreads: readonly CommentThread[],
  kept: ReadonlyMap<number, CommentThread>,
): CommentThread[] {
  if (kept.size === 0) return [...serverThreads]
  const present = new Set(serverThreads.map((t) => t.id))
  const extra = [...kept.values()].filter((t) => !present.has(t.id))
  if (extra.length === 0) return [...serverThreads]
  return [...serverThreads, ...extra].sort((a, b) => a.id - b.id)
}
