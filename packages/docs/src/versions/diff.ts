// Block-level text diff for version compare (feature #4 §1.4, v1 scope).
//
// Deliberately MODEST: block-level only. We serialize each document to an array of
// per-block text lines (one line per textual block — paragraph / heading / code block,
// plus a marker for atoms like images/rules), then run a compact LCS line-diff. No
// char-level and no rich-format diff — both are explicitly out of scope (§8).

/** Minimal ProseMirror-JSON node shape (the bits the walk reads). */
export interface PMNode {
  type: string
  text?: string
  content?: PMNode[]
  attrs?: Record<string, unknown>
}

export type DiffType = 'unchanged' | 'added' | 'removed' | 'changed' | 'too-large'

// Guard against the O(n*m) LCS table blowing up on huge docs (Steve review 🟡):
// n*m cells of allocation + work freezes the UI. Above this product we skip the
// fine-grained diff and return a single `too-large` sentinel row so the panel can
// show "document too large to diff" instead of hanging. Tuned so typical docs are
// unaffected (e.g. 800x800 blocks = 640k cells is fine; well beyond a real doc).
export const MAX_DIFF_CELLS = 1_000_000

/**
 * One diff row. `unchanged|added|removed` carry `text`; `changed` carries `before`/`after`
 * (a removed line immediately replaced by an added line, paired for a tidier render).
 */
export interface DiffEntry {
  type: DiffType
  text?: string
  before?: string
  after?: string
}

// Textual block nodes whose inline content becomes a single diff line. Container blocks
// (lists, blockquote, table…) are not listed — the walk recurses into them so their inner
// paragraphs/headings each yield their own line.
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock'])

function inlineText(node: PMNode): string {
  if (node.text != null) return node.text
  if (!node.content) return ''
  return node.content.map(inlineText).join('')
}

/** Serialize a PM doc to an ordered array of block text lines (the diff unit). */
export function docToBlocks(doc: PMNode | null | undefined): string[] {
  const out: string[] = []
  const walk = (node: PMNode): void => {
    if (TEXT_BLOCKS.has(node.type)) {
      out.push(inlineText(node))
      return
    }
    if (node.type === 'image') {
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      out.push(alt ? `[image: ${alt}]` : '[image]')
      return
    }
    if (node.type === 'horizontalRule') {
      out.push('———')
      return
    }
    for (const child of node.content ?? []) walk(child)
  }
  for (const child of doc?.content ?? []) walk(child)
  return out
}

interface RawOp {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

// LCS length table (suffix form): dp[i][j] = LCS length of a[i:] and b[j:].
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  return dp
}

function rawDiff(a: string[], b: string[]): RawOp[] {
  const dp = lcsTable(a, b)
  const ops: RawOp[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ type: 'unchanged', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'removed', text: a[i] })
      i++
    } else {
      ops.push({ type: 'added', text: b[j] })
      j++
    }
  }
  while (i < a.length) ops.push({ type: 'removed', text: a[i++] })
  while (j < b.length) ops.push({ type: 'added', text: b[j++] })
  return ops
}

// Pair a removed-run immediately followed by an added-run into `changed` rows; the
// surplus on either side stays a plain removed/added row.
function coalesce(ops: RawOp[]): DiffEntry[] {
  const out: DiffEntry[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'removed') {
      const removed: string[] = []
      while (i < ops.length && ops[i].type === 'removed') removed.push(ops[i++].text)
      const added: string[] = []
      while (i < ops.length && ops[i].type === 'added') added.push(ops[i++].text)
      const paired = Math.min(removed.length, added.length)
      for (let k = 0; k < paired; k++) {
        out.push({ type: 'changed', before: removed[k], after: added[k] })
      }
      for (let k = paired; k < removed.length; k++) out.push({ type: 'removed', text: removed[k] })
      for (let k = paired; k < added.length; k++) out.push({ type: 'added', text: added[k] })
    } else {
      out.push({ type: ops[i].type, text: ops[i].text })
      i++
    }
  }
  return out
}

/** Block-level diff between two arrays of block lines. */
export function diffBlocks(before: string[], after: string[]): DiffEntry[] {
  // Size cap: skip the O(n*m) LCS when the table would be too large (UI-freeze guard).
  if (before.length * after.length > MAX_DIFF_CELLS) {
    return [{ type: 'too-large' }]
  }
  return coalesce(rawDiff(before, after))
}

/** Block-level diff between two PM documents. */
export function diffDocs(before: PMNode | null | undefined, after: PMNode | null | undefined): DiffEntry[] {
  return diffBlocks(docToBlocks(before), docToBlocks(after))
}
