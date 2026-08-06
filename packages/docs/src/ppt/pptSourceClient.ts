// Source fetch client for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583).
//
// The backend PPT router (octo-docs-backend #161) serves the rendered deck source at
// `GET /api/v1/ppt/docs/:docId/source` and mounts NO `/ppt/frame/:id` host page. Because that
// endpoint sits behind the app's auth / `X-Space-Id` / language interceptors (a header-token auth
// scheme — an iframe `src` navigation would carry none of them and 401), the source is FETCHED
// through the shared apiClient here and then injected by the container into a sandboxed opaque-origin
// `srcdoc` frame, rather than navigating a frame at a bespoke route the backend does not serve.
//
// Bento decks are single self-contained HTML files, so `format=html` returns the whole renderable
// deck; the container hosts it in an isolated (opaque-origin) `srcdoc` document. This module performs
// the ONLY network I/O of the PPT source path and issues NO Hocuspocus token.

import { apiClient } from '../octoweb/index.ts'
import { buildSourceUrl } from './pptSource.ts'
import type { PptBootstrapMode } from './bootstrapTransfer.ts'

export interface FetchPptSourceParams {
  docId: string
  mode: PptBootstrapMode
  version: 'latest' | number
  /** Owning space, forwarded as `X-Space-Id` for source scoping (parity with getDoc). */
  space?: string
}

/**
 * Fetch a deck's rendered single-file Bento source (`format=html`) through the shared apiClient, so
 * the app's auth / `X-Space-Id` / language interceptors apply. Returns the HTML string the container
 * injects into its opaque-origin `srcdoc` frame. The backend enforces what source the caller's role
 * may load; this never bypasses that.
 */
export async function fetchPptSourceHtml(params: FetchPptSourceParams): Promise<string> {
  const { docId, mode, version, space } = params
  const url = buildSourceUrl({ docId, mode, version, format: 'html' })
  const config = space ? { headers: { 'X-Space-Id': space } } : undefined
  const { data } = await apiClient().get<string>(url, config)
  return typeof data === 'string' ? data : String(data ?? '')
}
