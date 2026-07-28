import { resolveOctoDocBase } from './htmlDocFrameHelpers.ts'
import { getWKApp } from '../octoweb/index.ts'

function octoDocHeaders(base: Record<string, string>): Record<string, string> {
  const token = getWKApp().loginInfo?.token
  return token ? { ...base, token } : base
}

export interface DiffSummary {
  added: number
  removed: number
  modified: number
}

export interface DiffChange {
  kind: 'added' | 'removed' | 'modified'
  before_aid?: string
  after_aid?: string
  dom_path: string
  before_path?: string
  after_path?: string
  before_html?: string
  after_html?: string
}

export interface DiffCodeHunk {
  old_start: number
  old_lines: number
  new_start: number
  new_lines: number
  lines: string[]
}

export interface DiffResult {
  from: number
  to: number
  summary: DiffSummary
  changes: DiffChange[]
  code_hunks: DiffCodeHunk[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`octo-doc diff invalid ${field}`)
  return value as number
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const parsed = requiredInteger(value, field)
  if (parsed < 1) throw new Error(`octo-doc diff invalid ${field}`)
  return parsed
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`octo-doc diff invalid ${field}`)
  return value
}

function parseSummary(value: unknown): DiffSummary {
  if (!isRecord(value)) throw new Error('octo-doc diff missing summary')
  return {
    added: requiredInteger(value.added, 'summary.added'),
    removed: requiredInteger(value.removed, 'summary.removed'),
    modified: requiredInteger(value.modified, 'summary.modified'),
  }
}

function parseChange(value: unknown, index: number): DiffChange {
  if (!isRecord(value)) throw new Error(`octo-doc diff invalid changes[${index}]`)
  const kind = value.kind
  if (kind !== 'added' && kind !== 'removed' && kind !== 'modified') {
    throw new Error(`octo-doc diff invalid changes[${index}].kind`)
  }
  if (typeof value.dom_path !== 'string' || !value.dom_path) {
    throw new Error(`octo-doc diff invalid changes[${index}].dom_path`)
  }
  const change: DiffChange = {
    kind,
    dom_path: value.dom_path,
    before_aid: optionalString(value.before_aid, `changes[${index}].before_aid`),
    after_aid: optionalString(value.after_aid, `changes[${index}].after_aid`),
    before_path: optionalString(value.before_path, `changes[${index}].before_path`),
    after_path: optionalString(value.after_path, `changes[${index}].after_path`),
    before_html: optionalString(value.before_html, `changes[${index}].before_html`),
    after_html: optionalString(value.after_html, `changes[${index}].after_html`),
  }
  if (kind !== 'added' && !change.before_aid && !change.before_path) {
    throw new Error(`octo-doc diff missing old locator for changes[${index}]`)
  }
  if (kind !== 'removed' && !change.after_aid && !change.after_path) {
    throw new Error(`octo-doc diff missing new locator for changes[${index}]`)
  }
  return change
}

function parseCodeHunk(value: unknown, index: number): DiffCodeHunk {
  if (!isRecord(value) || !Array.isArray(value.lines) || !value.lines.every((line) => typeof line === 'string')) {
    throw new Error(`octo-doc diff invalid code_hunks[${index}]`)
  }
  const hunk = {
    old_start: requiredPositiveInteger(value.old_start, `code_hunks[${index}].old_start`),
    old_lines: requiredInteger(value.old_lines, `code_hunks[${index}].old_lines`),
    new_start: requiredPositiveInteger(value.new_start, `code_hunks[${index}].new_start`),
    new_lines: requiredInteger(value.new_lines, `code_hunks[${index}].new_lines`),
    lines: value.lines,
  }
  let oldLines = 0
  let newLines = 0
  hunk.lines.forEach((line, lineIndex) => {
    const prefix = line[0]
    if (prefix !== ' ' && prefix !== '-' && prefix !== '+') {
      throw new Error(`octo-doc diff invalid code_hunks[${index}].lines[${lineIndex}]`)
    }
    if (prefix !== '+') oldLines++
    if (prefix !== '-') newLines++
  })
  if (oldLines !== hunk.old_lines || newLines !== hunk.new_lines) {
    throw new Error(`octo-doc diff invalid code_hunks[${index}] line counts`)
  }
  return hunk
}

function parseDiffResult(value: unknown): DiffResult {
  if (!isRecord(value)) throw new Error('octo-doc diff response must be an object')
  const summary = parseSummary(value.summary)
  if (!Array.isArray(value.changes)) throw new Error('octo-doc diff missing changes')
  if (!Array.isArray(value.code_hunks)) throw new Error('octo-doc diff missing code_hunks')
  return {
    from: requiredPositiveInteger(value.from, 'from'),
    to: requiredPositiveInteger(value.to, 'to'),
    summary,
    changes: value.changes.map(parseChange),
    code_hunks: value.code_hunks.map(parseCodeHunk),
  }
}

export async function getVersionSource(slug: string, version: string | number, signal?: AbortSignal): Promise<string> {
  const url = `${resolveOctoDocBase()}/v1/docs/${encodeURIComponent(slug)}/versions/${encodeURIComponent(
    String(version),
  )}/source`
  const res = await fetch(url, {
    credentials: 'include',
    headers: octoDocHeaders({ Accept: 'text/html' }),
    signal,
  })
  if (!res.ok) throw new Error(`octo-doc getVersionSource failed: ${res.status}`)
  return res.text()
}

export async function getDiff(
  slug: string,
  from: string | number,
  to: string | number,
  signal?: AbortSignal,
): Promise<DiffResult> {
  const params = new URLSearchParams({ from: String(from), to: String(to) })
  const url = `${resolveOctoDocBase()}/v1/docs/${encodeURIComponent(slug)}/diff?${params.toString()}`
  const res = await fetch(url, {
    credentials: 'include',
    headers: octoDocHeaders({ Accept: 'application/json' }),
    signal,
  })
  if (!res.ok) throw new Error(`octo-doc getDiff failed: ${res.status}`)
  const json = (await res.json()) as unknown
  return parseDiffResult(isRecord(json) && 'data' in json ? json.data : json)
}
