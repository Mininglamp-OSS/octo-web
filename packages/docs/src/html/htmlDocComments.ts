// octo-doc comment data layer (env ring 2b).
//
// SEPARATE BACKEND: comments for an html doc live in octo-doc — the SAME distinct deployment
// that serves the published HTML (see HtmlDocView.resolveOctoDocBase) — NOT the same-origin Yjs
// `/api/v1` docs backend. So every call here is a raw `fetch` (credentials:'include' to carry the
// octo-doc share-code cookie / write-token session) against resolveOctoDocBase() + `/v1/comments`,
// exactly like the read-only render fetch. This must never route through the octoweb apiClient.
//
// DISTINCT ANCHOR MODEL: octo-doc anchors are text/element descriptors (see Anchor below), a
// completely different scheme from the Yjs RelativePosition anchors in ../comments/anchor.ts.
// That module is NOT reusable here.

import { resolveOctoDocBase } from './HtmlDocView.tsx'
import { getWKApp } from '../octoweb/index.ts'

// octo-doc verifies identity via the `token` header (octo convention, not Authorization).
// Comment read/write need it so the caller is resolved to a creator/reader; without it the
// request is anonymous and octo-doc 404s/denies it. Same scheme as the render fetch.
function octoDocHeaders(base: Record<string, string>): Record<string, string> {
  const tok = getWKApp().loginInfo?.token
  return tok ? { ...base, token: tok } : base
}

/**
 * A text-range anchor: the human selected free text with no stable element id nearby.
 * `text` is the exact selected string; the surrounding context helps octo-doc re-locate the
 * range if the document drifts.
 */
export interface TextAnchor {
  kind: 'text'
  text: string
  context_before?: string
  context_after?: string
}

/**
 * An element anchor: the selection resolved to an element carrying a stable `data-odoc-aid`
 * (agent-authored id). This is the preferred, drift-resistant anchor — `selector` is the
 * canonical `[data-odoc-aid="{aid}"]` locator and `label` is the tag name for display.
 */
export interface ElementAnchor {
  kind: 'element'
  aid: string
  selector: string
  label?: string
}

export type Anchor = TextAnchor | ElementAnchor

/**
 * Author object as returned by octo-doc (mirrors backend core.Author). Comments carry the
 * full author, not a bare uid string, so the UI can show a display name + avatar.
 */
export interface OctoDocAuthor {
  login: string
  name?: string
  avatar_url?: string | null
  kind?: string
}

/** Wire shape of a single octo-doc comment (roots and replies share this shape). */
export interface OctoDocComment {
  id: string
  text: string
  /** Present on roots that were anchored to a selection; absent on replies / doc-level notes. */
  anchor?: Anchor | null
  parent_id?: string | null
  author?: OctoDocAuthor | null
  created_at?: string | null
}

/**
 * Format an ISO/RFC3339 timestamp as `YYYY-MM-DD HH:mm` in the viewer's local timezone.
 * Comments need minute precision (unlike DocMoreMenu's date-only formatter). Unparseable
 * input yields '' so the caller drops the time instead of rendering "Invalid Date".
 */
export function formatCommentTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A root comment plus its nested replies (list groups replies under their root). */
export interface OctoDocCommentThread extends OctoDocComment {
  replies: OctoDocComment[]
}

/** GET /v1/comments response: roots (each with its `replies`). */
export interface ListCommentsResponse {
  roots: OctoDocCommentThread[]
}

/** POST /v1/comments response: the created comment id. */
export interface CreateCommentResponse {
  id: string
}

/** Build `<octo-doc-base>/v1/comments` — the single comment endpoint (verb differs GET vs POST). */
function commentsUrl(): string {
  return `${resolveOctoDocBase()}/v1/comments`
}

/**
 * List comment threads for a published doc version.
 *
 * Requires octo-doc READ permission (share-code cookie / write token), so the credentialed
 * fetch carries whatever octo-doc session the browser holds. The doc is addressed by slug +
 * version (same coordinates as the read-only render), passed as query params.
 */
export async function listComments(
  slug: string,
  version: string,
): Promise<OctoDocCommentThread[]> {
  const params = new URLSearchParams({ slug, version })
  const res = await fetch(`${commentsUrl()}?${params.toString()}`, {
    credentials: 'include',
    headers: octoDocHeaders({ Accept: 'application/json' }),
  })
  if (!res.ok) throw new Error(`octo-doc listComments failed: ${res.status}`)
  const data = (await res.json()) as { data?: OctoDocCommentThread[] } | null
  // Backend list envelope is {data, pagination} (writeList), not {roots}.
  return data?.data ?? []
}

export interface CreateCommentInput {
  text: string
  version: string
  /** Selection anchor for a NEW root comment; omit for a doc-level note or a reply. */
  anchor?: Anchor | null
  /** Set when replying under an existing comment (replies carry no anchor). */
  parentId?: string | null
}

/**
 * Create a comment (root or reply) on a published doc.
 *
 * Body matches the frozen octo-doc contract: {slug, text, version, parent_id?, anchor?}. The
 * frontend only WRITES the comment here — it does NOT trigger the AI. Triggering is the separate,
 * explicit "让 AI 处理" action (buildAgentInstruction + openDocForward), never coupled to posting a
 * comment (trigger mode C: human must click).
 */
export async function createComment(
  slug: string,
  input: CreateCommentInput,
): Promise<CreateCommentResponse> {
  const body: Record<string, unknown> = {
    slug,
    text: input.text,
    version: input.version,
  }
  // Contract is exclusive: a reply carries parent_id only, a root carries anchor only.
  // Enforce here so the data layer can never emit the ambiguous {parent_id, anchor} pair.
  if (input.parentId != null) body.parent_id = input.parentId
  else if (input.anchor != null) body.anchor = input.anchor

  const res = await fetch(commentsUrl(), {
    method: 'POST',
    credentials: 'include',
    headers: octoDocHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`octo-doc createComment failed: ${res.status}`)
  return (await res.json()) as CreateCommentResponse
}
