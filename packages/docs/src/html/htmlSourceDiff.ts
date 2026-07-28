// Pure, dependency-free line + char diff for the code-diff tab.
//
// Used when the backend DiffResult omits a pre-computed `html_diff`: we diff the two raw sources
// on the client. Kept side-effect-free (no React / fetch / DOM) so it unit-tests in isolation.

export interface DiffRow {
  op: 'equal' | 'add' | 'remove' | 'replace'
  oldLine?: number
  newLine?: number
  oldText?: string
  newText?: string
}

/** Split source into lines, normalising CRLF. */
export function toLines(src: string): string[] {
  return src.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * Myers-ish LCS line diff → aligned rows. Adjacent remove+add pairs are merged into a single
 * `replace` row so the two-column view shows old ↔ new side by side (char emphasis happens in the
 * renderer). O(n·m) DP — fine for typical single-doc sources; large inputs are still bounded by the
 * doc size the publish path allows.
 */
export function diffLines(oldSrc: string, newSrc: string): DiffRow[] {
  const a = toLines(oldSrc)
  const b = toLines(newSrc)
  const n = a.length
  const m = b.length
  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  const pending: DiffRow[] = []
  const flushPending = () => {
    // Pair leading removes with trailing adds into `replace` rows for the side-by-side view.
    const removes = pending.filter((r) => r.op === 'remove')
    const adds = pending.filter((r) => r.op === 'add')
    const pairs = Math.min(removes.length, adds.length)
    for (let k = 0; k < pairs; k++) {
      rows.push({
        op: 'replace',
        oldLine: removes[k].oldLine,
        newLine: adds[k].newLine,
        oldText: removes[k].oldText,
        newText: adds[k].newText,
      })
    }
    for (let k = pairs; k < removes.length; k++) rows.push(removes[k])
    for (let k = pairs; k < adds.length; k++) rows.push(adds[k])
    pending.length = 0
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flushPending()
      rows.push({ op: 'equal', oldLine: i + 1, newLine: j + 1, oldText: a[i], newText: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pending.push({ op: 'remove', oldLine: i + 1, oldText: a[i] })
      i++
    } else {
      pending.push({ op: 'add', newLine: j + 1, newText: b[j] })
      j++
    }
  }
  while (i < n) {
    pending.push({ op: 'remove', oldLine: i + 1, oldText: a[i] })
    i++
  }
  while (j < m) {
    pending.push({ op: 'add', newLine: j + 1, newText: b[j] })
    j++
  }
  flushPending()
  return rows
}

export interface CharSpan {
  same: boolean
  text: string
}

/**
 * Char-level diff of two strings → aligned span lists for old + new (LCS over characters). Powers
 * the intra-line emphasis on `replace` rows so a viewer sees exactly which characters changed.
 */
export function diffChars(oldText: string, newText: string): { old: CharSpan[]; new: CharSpan[] } {
  const a = Array.from(oldText)
  const b = Array.from(newText)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const oldSpans: CharSpan[] = []
  const newSpans: CharSpan[] = []
  const pushOld = (same: boolean, ch: string) => mergeSpan(oldSpans, same, ch)
  const pushNew = (same: boolean, ch: string) => mergeSpan(newSpans, same, ch)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushOld(true, a[i])
      pushNew(true, b[j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushOld(false, a[i])
      i++
    } else {
      pushNew(false, b[j])
      j++
    }
  }
  while (i < n) pushOld(false, a[i++])
  while (j < m) pushNew(false, b[j++])
  return { old: oldSpans, new: newSpans }
}

function mergeSpan(spans: CharSpan[], same: boolean, ch: string) {
  const last = spans[spans.length - 1]
  if (last && last.same === same) last.text += ch
  else spans.push({ same, text: ch })
}
