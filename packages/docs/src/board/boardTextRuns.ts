export const TEXT_RUNS_KEY = 'textRuns' as const

export interface BoardTextStyle {
  fontFamily?: number
  fontSize?: number
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export interface BoardTextRun extends BoardTextStyle {
  start: number
  end: number
}

export type BoardTextStylePatch = {
  [K in keyof BoardTextStyle]?: BoardTextStyle[K] | null
}

const STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'color',
  'bold',
  'italic',
  'underline',
] as const satisfies readonly (keyof BoardTextStyle)[]

/**
 * Invariants: offsets are UTF-16 code-unit offsets (the same units as
 * selectionStart/selectionEnd), ranges are sorted non-overlapping half-open
 * intervals, empty ranges/styles are omitted, and adjacent equal styles merge.
 * Explicit false is retained because it overrides an element-level true value.
 */
export function normalizeTextRuns(
  runs: readonly BoardTextRun[],
  textLength: number,
): BoardTextRun[] {
  const length = safeLength(textLength)
  const cleaned = runs.flatMap((run) => {
    if (!isRecord(run) || !Number.isInteger(run.start) || !Number.isInteger(run.end)) return []
    const start = clamp(run.start, length)
    const end = clamp(run.end, length)
    const style = readStyle(run)
    return start < end && hasStyle(style) ? [{ start, end, style }] : []
  })
  if (!cleaned.length) return []

  const boundaries = [...new Set(cleaned.flatMap(({ start, end }) => [start, end]))].sort(
    (a, b) => a - b,
  )
  const result: BoardTextRun[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    const style: BoardTextStyle = {}
    // Later runs win per property; unspecified properties remain composable.
    for (const run of cleaned) {
      if (run.start <= start && run.end >= end) Object.assign(style, run.style)
    }
    appendRun(result, start, end, style)
  }
  return result
}

/** Safely read customData.textRuns; malformed entries and properties are ignored. */
export function parseTextRuns(customData: unknown, textLength: number): BoardTextRun[] {
  if (!isRecord(customData) || !Array.isArray(customData[TEXT_RUNS_KEY])) return []
  const runs: BoardTextRun[] = []
  for (const value of customData[TEXT_RUNS_KEY]) {
    if (!isRecord(value) || !Number.isInteger(value.start) || !Number.isInteger(value.end)) continue
    runs.push({ start: value.start as number, end: value.end as number, ...readStyle(value) })
  }
  return normalizeTextRuns(runs, textLength)
}

/** Return the normalized fragment to merge into an Excalidraw element's customData. */
export function serializeTextRuns(
  runs: readonly BoardTextRun[],
  textLength: number,
): { textRuns: BoardTextRun[] } {
  return { textRuns: normalizeTextRuns(runs, textLength) }
}

/** Apply only the specified properties to a selection. null removes a run property; false is data. */
export function applyTextStyle(
  runs: readonly BoardTextRun[],
  start: number,
  end: number,
  patch: BoardTextStylePatch,
  textLength: number,
): BoardTextRun[] {
  const length = safeLength(textLength)
  const selectionStart = clamp(Math.min(start, end), length)
  const selectionEnd = clamp(Math.max(start, end), length)
  const normalized = normalizeTextRuns(runs, length)
  if (selectionStart === selectionEnd) return normalized

  const boundaries = [
    ...new Set([
      0,
      length,
      selectionStart,
      selectionEnd,
      ...normalized.flatMap((run) => [run.start, run.end]),
    ]),
  ].sort((a, b) => a - b)
  const result: BoardTextRun[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const intervalStart = boundaries[index]
    const intervalEnd = boundaries[index + 1]
    const style = styleAt(normalized, intervalStart)
    if (intervalStart >= selectionStart && intervalEnd <= selectionEnd) applyPatch(style, patch)
    appendRun(result, intervalStart, intervalEnd, style)
  }
  return result
}

/** Remove properties superseded by a whole-element style so stale local overrides cannot win. */
export function clearTextStyleProperties(
  runs: readonly BoardTextRun[],
  keys: readonly (keyof BoardTextStyle)[],
  textLength: number,
): BoardTextRun[] {
  const dropped = new Set(keys)
  return normalizeTextRuns(
    normalizeTextRuns(runs, textLength).map((run) => {
      const next = { ...run }
      for (const key of dropped) delete next[key]
      return next
    }),
    textLength,
  )
}

/**
 * Rebase runs after one input edit. The post-edit caret locates the changed span
 * when neighboring text is identical; offsets use UTF-16 code units.
 * Unchanged text keeps its runs; replacement text gets insertedStyle when supplied.
 */
export function transformTextRuns(
  runs: readonly BoardTextRun[],
  oldText: string,
  newText: string,
  insertedStyle: BoardTextStyle | undefined,
  caret: number,
): BoardTextRun[] {
  const normalized = normalizeTextRuns(runs, oldText.length)
  const editCaret = clamp(caret, newText.length)

  let suffix = 0
  const maxSuffix = Math.min(oldText.length, newText.length - editCaret)
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) suffix += 1

  const oldEnd = oldText.length - suffix
  const newEnd = newText.length - suffix
  let prefix = 0
  while (
    prefix < oldEnd &&
    prefix < newEnd &&
    oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)
  ) prefix += 1
  const delta = newEnd - oldEnd
  const rebased: BoardTextRun[] = []
  for (const run of normalized) {
    if (run.end <= prefix) {
      rebased.push(run)
    } else if (run.start >= oldEnd) {
      rebased.push({ ...run, start: run.start + delta, end: run.end + delta })
    } else {
      if (run.start < prefix) rebased.push({ ...run, end: prefix })
      if (run.end > oldEnd) rebased.push({ ...run, start: newEnd, end: run.end + delta })
    }
  }
  const style = readStyle(insertedStyle)
  if (prefix < newEnd && hasStyle(style)) rebased.push({ start: prefix, end: newEnd, ...style })
  return normalizeTextRuns(rebased, newText.length)
}

function styleAt(runs: readonly BoardTextRun[], offset: number): BoardTextStyle {
  const run = runs.find((candidate) => candidate.start <= offset && offset < candidate.end)
  return run ? readStyle(run) : {}
}

function applyPatch(style: BoardTextStyle, patch: BoardTextStylePatch): void {
  for (const key of STYLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    const value = patch[key]
    if (value === null || value === undefined) delete style[key]
    else if (isStyleValue(key, value)) Object.assign(style, { [key]: value })
  }
}

function readStyle(value: unknown): BoardTextStyle {
  if (!isRecord(value)) return {}
  const style: BoardTextStyle = {}
  for (const key of STYLE_KEYS) {
    const candidate = value[key]
    if (isStyleValue(key, candidate)) Object.assign(style, { [key]: candidate })
  }
  return style
}

function isStyleValue(key: keyof BoardTextStyle, value: unknown): boolean {
  if (key === 'fontFamily' || key === 'fontSize') return typeof value === 'number' && Number.isFinite(value)
  if (key === 'color') return typeof value === 'string'
  return typeof value === 'boolean'
}

function appendRun(result: BoardTextRun[], start: number, end: number, style: BoardTextStyle): void {
  if (start >= end || !hasStyle(style)) return
  const previous = result.at(-1)
  if (previous && previous.end === start && sameStyle(previous, style)) previous.end = end
  else result.push({ start, end, ...style })
}

function sameStyle(left: BoardTextStyle, right: BoardTextStyle): boolean {
  return STYLE_KEYS.every((key) => left[key] === right[key])
}

function hasStyle(style: BoardTextStyle): boolean {
  return STYLE_KEYS.some((key) => style[key] !== undefined)
}

function safeLength(length: number): number {
  return Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0
}

function clamp(offset: number, length: number): number {
  return Math.min(length, Math.max(0, offset))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
