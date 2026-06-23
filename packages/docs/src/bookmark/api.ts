// Link-card (Open Graph) REST (SCHEMA-SPEC §15 `bookmark` node, backend §8.x).
//
// Like every other docs REST call, this goes through WKApp.apiClient with a BARE-RELATIVE
// `/docs/...` path (inheriting the `/api/v1/` baseURL → `/api/v1/docs/...`). The global
// interceptor injects the octo `token` header; no auth code here.
//
// The backend fetches the URL's Open Graph metadata server-side (no CORS / SSRF exposure in
// the browser) and returns the PM-frozen field set EXACTLY:
//   { url, title, description, image, siteName, fetchedAt }
// fetchLinkCard maps the response to that exact shape; any field the backend could not derive
// degrades gracefully to null (the bookmark card then omits that piece — no thumbnail without
// `image`, the raw url shown when `title` is missing). These names are authoritative — do NOT
// invent aliases (the "front/back each mock an imagined contract" trap).

import { apiClient } from '../octoweb/index.ts'

/** The bookmark node's attr set — identical field names to the backend link-card response. */
export interface LinkCard {
  /** The (canonical) URL the card points to. Always present; falls back to the requested url. */
  url: string
  /** OG title, or null when the backend could not derive one (card shows the url instead). */
  title: string | null
  /** OG description, or null. */
  description: string | null
  /** OG image (thumbnail) URL, or null (card renders no thumbnail). */
  image: string | null
  /** OG site name, or null. */
  siteName: string | null
  /** When the backend fetched the metadata (ISO-8601 string), or null. */
  fetchedAt: string | null
}

/** Raw response — every field optional so a partial OG result maps without throwing. */
type LinkCardResponse = Partial<LinkCard>

/**
 * POST /docs/{docId}/link-card { url } → the OG metadata for `url` (needs reader).
 * Maps the response to the exact { url, title, description, image, siteName, fetchedAt } set,
 * defaulting any missing field to null and echoing the requested url when the backend omits it.
 */
export async function fetchLinkCard(docId: string, url: string): Promise<LinkCard> {
  const { data } = await apiClient().post<LinkCardResponse>(`/docs/${docId}/link-card`, { url })
  return {
    url: data?.url ?? url,
    title: data?.title ?? null,
    description: data?.description ?? null,
    image: data?.image ?? null,
    siteName: data?.siteName ?? null,
    fetchedAt: data?.fetchedAt ?? null,
  }
}
