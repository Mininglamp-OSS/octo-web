// octo-doc admin (delete) data layer for html docs.
//
// SEPARATE BACKEND (see htmlDocComments): raw credentialed fetch against resolveOctoDocBase().
// Delete is author-only; the caller gates the UI entry, this layer just issues the request and
// throws on a non-ok response so the UI can surface the failure.

import { resolveOctoDocBase } from './HtmlDocView.tsx'
import { getWKApp } from '../octoweb/index.ts'

function octoDocHeaders(base: Record<string, string>): Record<string, string> {
  const tok = getWKApp().loginInfo?.token
  return tok ? { ...base, token: tok } : base
}

/** DELETE <base>/docs-admin/{slug} — remove the published doc (nginx rewrites to the doc's
 * /v1/docs/{slug} and attaches the octo token; the bare /v1/ path is proxied to octo-server,
 * which has no doc delete endpoint). Throws on a non-ok response. */
export async function deleteDoc(slug: string): Promise<void> {
  const url = `${resolveOctoDocBase()}/docs-admin/${encodeURIComponent(slug)}`
  const res = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: octoDocHeaders({ Accept: 'application/json' }),
  })
  if (!res.ok) throw new Error(`octo-doc deleteDoc failed: ${res.status}`)
}
