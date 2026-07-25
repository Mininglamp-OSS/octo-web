// octo-doc version-list data layer (read-only, html doc header ≡ menu).
//
// SEPARATE BACKEND: like htmlDocComments, versions live in octo-doc (not the /api/v1 Yjs
// backend), so this is a raw credentialed fetch against resolveOctoDocBase(). The version
// list is addressed by a PATH slug — GET <base>/v1/docs/{slug}/versions — per the octo-doc
// contract {data:{slug,title,versions:[{n,created_at}]}}, distinct from the query-param
// /comments endpoint.

import { resolveOctoDocBase } from './HtmlDocView.tsx'
import { getWKApp } from '../octoweb/index.ts'

// octo-doc verifies identity via the `token` header (octo convention, not Authorization);
// same scheme as the render / comments fetches.
function octoDocHeaders(base: Record<string, string>): Record<string, string> {
  const tok = getWKApp().loginInfo?.token
  return tok ? { ...base, token: tok } : base
}

export interface HtmlDocVersion {
  n: number
  created_at?: string | null
}

/** GET <base>/v1/docs/{slug}/versions → published version numbers (newest-first per backend). */
export async function listVersions(slug: string): Promise<HtmlDocVersion[]> {
  const url = `${resolveOctoDocBase()}/v1/docs/${encodeURIComponent(slug)}/versions`
  const res = await fetch(url, {
    credentials: 'include',
    headers: octoDocHeaders({ Accept: 'application/json' }),
  })
  if (!res.ok) throw new Error(`octo-doc listVersions failed: ${res.status}`)
  const data = (await res.json()) as { data?: { versions?: HtmlDocVersion[] } } | null
  return data?.data?.versions ?? []
}
