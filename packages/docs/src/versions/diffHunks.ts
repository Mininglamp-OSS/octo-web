// Grouping a flat block diff into UNIFIED-DIFF HUNKS with real line numbers.
//
// WHY THIS EXISTS: versions/diff.ts produces a flat `DiffEntry[]` — one row per block, in document
// order, with no positions. The prototype's change review (`.change-hunk` / `.unified-diff`) reads
// like a code diff instead: each changed region is its own bordered card with a `@@ … @@` header, and
// every row carries an OLD line number, a NEW line number and a `-`/`+`/` ` marker. That shape is
// what makes a diff scannable, and it is purely a re-presentation of the same data — so the mapping
// lives here as a pure function (unit-testable, no React) rather than inside the renderer.
//
// TWO THINGS THE PROTOTYPE GETS WRONG AND THIS DELIBERATELY DOES NOT:
//   • The prototype hard-codes `newStart: change.oldStart` when it builds a hunk, so the "after"
//     column always repeats the "before" number. That is only ever right when a change neither adds
//     nor removes blocks. Here the two counters advance INDEPENDENTLY (a removal advances old only,
//     an insertion advances new only), so the numbers stay truthful once block counts diverge.
//   • The prototype's context line is `Math.max(1, oldStart - 1)` with the SECTION TITLE as its text
//     — a number and a string that need not belong to the same block. Here a context row is a REAL
//     `unchanged` entry, carrying its own text and its own pair of numbers.
//
// CONTEXT POLICY: one leading and one trailing unchanged row per hunk (`CONTEXT_LINES = 1`), which is
// what the prototype shows. Unchanged blocks further away are DROPPED — the point of this view is
// "what changed", and a long document otherwise renders hundreds of identical grey rows that bury the
// few that matter. `docToBlocks` order is stable, so dropping them loses no information the reader
// could act on; the full text is one click away in the version preview.

import type { DiffEntry } from './diff.ts'

/** How many unchanged rows to keep on each side of a change run. */
export const CONTEXT_LINES = 1

/** A row inside a hunk. `oldNumber` / `newNumber` are null on the side where the row does not exist. */
export interface HunkLine {
  /** 'context' is an unchanged row kept for orientation; the rest mirror DiffEntry kinds. */
  type: 'context' | 'added' | 'removed'
  text: string
  /** 1-based line number in the BEFORE document; null for an inserted row. */
  oldNumber: number | null
  /** 1-based line number in the AFTER document; null for a deleted row. */
  newNumber: number | null
}

/** One contiguous changed region, plus its context rows. */
export interface DiffHunk {
  /** Stable, 1-based index of this hunk within the diff — drives the `@@ 第 n 处 @@` header. */
  index: number
  /** First BEFORE line the hunk covers (context included); 1 when the hunk starts the document. */
  oldStart: number
  /** First AFTER line the hunk covers (context included). */
  newStart: number
  /** How many rows in the hunk are insertions. */
  addedCount: number
  /** How many rows in the hunk are deletions. */
  removedCount: number
  lines: HunkLine[]
}

/** True for entries that represent a real change (never `unchanged`, never the `too-large` sentinel). */
function isChange(d: DiffEntry): boolean {
  return d.type === 'added' || d.type === 'removed' || d.type === 'changed'
}

/**
 * Positioned view of one entry: which line numbers it occupies and which rows it becomes.
 *
 * A `changed` entry is diff.ts's coalesced "one removal immediately followed by one insertion", so it
 * expands back into TWO rows (the `-` then the `+`) — that is exactly the prototype's three-row
 * context/removed/added shape, and it is why a row list is built rather than reusing DiffEntry.
 */
interface Positioned {
  entry: DiffEntry
  rows: HunkLine[]
}

/**
 * Walk the flat diff once, assigning every entry its BEFORE and AFTER line numbers. The two counters
 * advance independently, which is the whole point: `unchanged` advances both, `removed` only the old
 * side, `added` only the new side, and `changed` both (it consumes one line on each side).
 */
function position(diff: DiffEntry[]): Positioned[] {
  let oldLine = 1
  let newLine = 1
  const out: Positioned[] = []
  for (const entry of diff) {
    if (entry.type === 'unchanged') {
      out.push({
        entry,
        rows: [{ type: 'context', text: entry.text ?? '', oldNumber: oldLine, newNumber: newLine }],
      })
      oldLine += 1
      newLine += 1
      continue
    }
    if (entry.type === 'removed') {
      out.push({
        entry,
        rows: [{ type: 'removed', text: entry.text ?? '', oldNumber: oldLine, newNumber: null }],
      })
      oldLine += 1
      continue
    }
    if (entry.type === 'added') {
      out.push({
        entry,
        rows: [{ type: 'added', text: entry.text ?? '', oldNumber: null, newNumber: newLine }],
      })
      newLine += 1
      continue
    }
    if (entry.type === 'changed') {
      out.push({
        entry,
        rows: [
          { type: 'removed', text: entry.before ?? '', oldNumber: oldLine, newNumber: null },
          { type: 'added', text: entry.after ?? '', oldNumber: null, newNumber: newLine },
        ],
      })
      oldLine += 1
      newLine += 1
      continue
    }
    // 'too-large' is a sentinel the caller short-circuits on; ignore defensively.
  }
  return out
}

/**
 * Group a flat block diff into hunks. Returns `[]` when there is nothing to show — an all-`unchanged`
 * diff, an empty diff, or the `too-large` sentinel — so the caller renders its own explicit empty
 * state instead of an empty box.
 */
export function toHunks(diff: DiffEntry[]): DiffHunk[] {
  if (diff.length === 0) return []
  if (diff.some((d) => d.type === 'too-large')) return []

  const positioned = position(diff)
  const hunks: DiffHunk[] = []
  let i = 0
  while (i < positioned.length) {
    if (!isChange(positioned[i].entry)) {
      i += 1
      continue
    }
    // Extend across every consecutive change, so one edited region is ONE card.
    let end = i
    while (end + 1 < positioned.length && isChange(positioned[end + 1].entry)) end += 1

    const from = Math.max(0, i - CONTEXT_LINES)
    const to = Math.min(positioned.length - 1, end + CONTEXT_LINES)
    const lines: HunkLine[] = []
    for (let k = from; k <= to; k++) {
      // Only unchanged neighbours may act as context; a change outside [i,end] cannot exist because
      // the run was extended maximally.
      lines.push(...positioned[k].rows)
    }

    const first = lines[0]
    hunks.push({
      index: hunks.length + 1,
      // A hunk that opens with an insertion has no BEFORE number on its first row; fall back to the
      // first row that does, then to 1, so the header never prints "undefined".
      oldStart: first.oldNumber ?? lines.find((l) => l.oldNumber != null)?.oldNumber ?? 1,
      newStart: first.newNumber ?? lines.find((l) => l.newNumber != null)?.newNumber ?? 1,
      addedCount: lines.filter((l) => l.type === 'added').length,
      removedCount: lines.filter((l) => l.type === 'removed').length,
      lines,
    })
    i = end + 1
  }
  return hunks
}
