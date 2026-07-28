// octo-doc single-version SOURCE + two-version DIFF data layer (read-only).
//
// SEPARATE BACKEND: like htmlDocComments / htmlDocVersions, source and diff live in octo-doc (NOT
// the same-origin Yjs `/api/v1` backend), so every call is a raw credentialed fetch against
// resolveOctoDocBase() carrying the octo `token` header. Never route through the octoweb apiClient.
//
// Endpoints (frozen contract this client targets):
//   GET <base>/v1/docs/{slug}/versions/{version}/source  → text/html raw published source
//   GET <base>/v1/docs/{slug}/diff?from={a}&to={b}       → {data: DiffResult}

import { resolveOctoDocBase } from './HtmlDocView.tsx'
import { getWKApp } from '../octoweb/index.ts'

// octo-doc verifies identity via the `token` header (octo convention, not Authorization).
function octoDocHeaders(base: Record<string, string>): Record<string, string> {
  const tok = getWKApp().loginInfo?.token
  return tok ? { ...base, token: tok } : base
}

/** A single structural change between two versions (page-diff highlight source). */
export interface DiffChange {
  /** add = new in `to`; remove = gone from `to`; replace = present in both, content differs. */
  op: 'add' | 'remove' | 'replace'
  /** Stable agent id of the changed element — the PREFERRED highlight locator. */
  aid?: string
  /** DOM path fallback when the element carries no aid (`body>section:nth-of-type(2)>p`). */
  path?: string
  old_text?: string
  new_text?: string
}

/** One line-oriented hunk of the raw-source diff (code-diff renderer input). */
export interface DiffHunk {
  op: 'equal' | 'add' | 'remove'
  /** 1-based line number in the OLD (from) source; absent on pure additions. */
  old_ln?: number
  /** 1-based line number in the NEW (to) source; absent on pure removals. */
  new_ln?: number
  text: string
}

/** The shared diff payload consumed by BOTH the code-diff and page-diff tabs. */
export interface DiffResult {
  from: number
  to: number
  /** Structural changes (page diff highlights). */
  changes: DiffChange[]
  /** Optional pre-computed line hunks; when absent the code tab diffs the two raw sources itself. */
  html_diff?: DiffHunk[]
}

/**
 * GET <base>/v1/docs/{slug}/versions/{version}/source → raw published HTML source (as stored).
 *
 * Read permission is required (share-code cookie / write token), so the credentialed fetch carries
 * whatever octo-doc session the browser holds. `signal` lets the caller abort a stale in-flight
 * request (version switch / unmount). Returns the source text verbatim — the caller decides how to
 * render it (never executed).
 */
export async function getVersionSource(
  slug: string,
  version: string | number,
  signal?: AbortSignal,
): Promise<string> {
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

/**
 * GET <base>/v1/docs/{slug}/diff?from={from}&to={to} → the shared DiffResult.
 *
 * Both tabs of HtmlDiffModal read this one payload: the code tab renders html_diff (or diffs the
 * two raw sources locally when it is absent), the page tab highlights `changes` by aid/path.
 * Fail-soft: a shape drift (missing `changes`) resolves to an empty change set rather than throwing.
 */
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
  const data = (await res.json()) as { data?: Partial<DiffResult> } | null
  const d = data?.data ?? {}
  return {
    from: typeof d.from === 'number' ? d.from : Number(from),
    to: typeof d.to === 'number' ? d.to : Number(to),
    changes: Array.isArray(d.changes) ? d.changes : [],
    html_diff: Array.isArray(d.html_diff) ? d.html_diff : undefined,
  }
}
