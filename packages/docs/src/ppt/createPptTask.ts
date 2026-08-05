// Create-slides (html_ppt) task helpers — the R2-F1 live create path.
//
// A Bento slide-deck is a first-class, B-owned document type created through its OWN endpoint
// (`POST /api/v1/ppt/docs`), NOT the generic `POST /api/v1/docs` seam and NOT a Tiptap rich doc.
// The create call is minted atomically server-side (strip template marker + new docId + drop
// collab), so the front end only chooses a fixed template + title, POSTs once with a client
// idempotency key, and then navigates to the editor route the BACKEND returns — it never builds a
// PPT route itself (no-fallthrough contract, XIN-1501 / R1).

import { apiClient } from '../octoweb/index.ts'
import { HTML_PPT_DOC_TYPE } from '../pages/docsApi.ts'

/** Re-exported so guards never re-hardcode the wire value. */
export { HTML_PPT_DOC_TYPE }

/**
 * The four fixed v1 templates (gate3 D6: no CRUD, no admin-extensible registry). Authored in
 * lockstep with the backend's accepted `templateId` set (blank/pitch/report/lesson). Order is the
 * 2×2 grid reading order used by the picker.
 */
export const PPT_TEMPLATES = ['blank', 'pitch', 'report', 'lesson'] as const
export type PptTemplateId = (typeof PPT_TEMPLATES)[number]

/** The template selected by default when the picker opens (design §2.2 — a clear focus start). */
export const DEFAULT_PPT_TEMPLATE: PptTemplateId = 'blank'

/**
 * Client-side title bound, a pre-check aligned with the backend's PPT-HUMAN-002 validation. The
 * BACKEND is authoritative — a `400 VALIDATION_ERROR` is surfaced inline regardless — so this only
 * spares an obviously-invalid round-trip (empty / absurdly long) and never widens what the server
 * accepts.
 */
export const PPT_TITLE_MAX = 200

/** Narrow a free string to a known template id (defensive; the picker only ever passes valid ids). */
export function isPptTemplate(id: string): id is PptTemplateId {
  return (PPT_TEMPLATES as readonly string[]).includes(id)
}

export interface CreatePptInput {
  title: string
  templateId: PptTemplateId
  /** Optional target folder; space is carried by the global `X-Space-Id` interceptor, not the body. */
  folderId?: string
  /**
   * Client-generated idempotency key (e.g. crypto.randomUUID). The SAME key must be reused across a
   * retry of the same submit so a lost-response retry reuses the server-side result instead of
   * minting a duplicate deck (hard metric #3).
   */
  idempotencyKey: string
}

export interface CreatePptResult {
  /** The PPT editor route to navigate to — taken verbatim from the backend, never built here. */
  editorUrl: string
  docId?: string
  title?: string
}

/** Shape of the `POST /ppt/docs` success body — the doc fields wrapped in the C-style `{ data }`. */
interface PptCreateEnvelope {
  editorUrl?: string
  docId?: string
  title?: string
  data?: {
    editorUrl?: string
    docId?: string
    title?: string
  }
}

/**
 * Generate a one-shot idempotency key. Prefers crypto.randomUUID; falls back to a
 * timestamp+random string on the rare host without it (same pattern as the HTML create flow).
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ppt-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Thrown when a `201` create response carries no `editorUrl`. We refuse to navigate to an
 * undefined route (that would be the exact frontend-fabricated fallback the no-fallthrough
 * contract forbids), so the caller shows a generic error and keeps the modal open.
 */
export class MissingEditorUrlError extends Error {
  constructor() {
    super('ppt create succeeded but the response carried no editorUrl')
    this.name = 'MissingEditorUrlError'
  }
}

/**
 * POST /api/v1/ppt/docs — create a Bento slide-deck from one of the four fixed templates.
 *
 * Body `{ title, templateId, folderId? }`; the required `Idempotency-Key` header carries the
 * client key so a retry of the same submit is deduped server-side. Success (`201`) resolves with
 * the backend-returned `editorUrl`; the caller navigates there and NOWHERE else. Errors propagate
 * unchanged so the caller can branch on `err.response?.status` (400 → inline, else → generic).
 */
export async function createPptDoc(input: CreatePptInput): Promise<CreatePptResult> {
  const body: { title: string; templateId: PptTemplateId; folderId?: string } = {
    title: input.title,
    templateId: input.templateId,
  }
  if (input.folderId) body.folderId = input.folderId
  const { data } = await apiClient().post<PptCreateEnvelope>('/ppt/docs', body, {
    headers: { 'Idempotency-Key': input.idempotencyKey },
  })
  // The backend wraps the doc in the C-style `{ data }` envelope; the host apiClient unwraps one
  // transport layer, so read `data.data.*` first and fall back to a flat body for resilience.
  const payload = data?.data ?? data ?? {}
  const editorUrl = (payload.editorUrl ?? '').trim()
  if (!editorUrl) throw new MissingEditorUrlError()
  return { editorUrl, docId: payload.docId, title: payload.title }
}
