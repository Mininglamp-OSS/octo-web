// Link minting for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583 / XIN-1621).
//
// P1-1 (round-5): `resolveDeckSpace()` (PptSurfacePage.tsx) reads a deep-link's dedicated `?sp=`
// carrier FIRST so a cross-space cold open resolves the deck's REAL space before the app shell has
// restored `currentSpaceId`. That read is only useful if something on the FE actually PRODUCES a PPT
// link carrying `?sp=` — and until this module, nothing did: `buildDocLink` mints `/d/:docId?sp=` for
// the STANDALONE rich-text route (a different route), the peer editor link arrives from the backend
// `editorUrl` verbatim, and the present route had no minting site at all. So a cross-space share fell
// through to the recipient's last-visited space and 404'd on the backend cross-space guard.
//
// These builders are the PPT-route analogue of `buildDocLink`: they stamp the deck's owning space
// onto the `?sp=` carrier the PPT routes read, so a link the FE produces resolves the right
// `X-Space-Id` on a cross-space cold open. They are pure (only read `window.location.origin`) so they
// are unit-testable and reusable from any producer (the create flow's forwarded editor link today; a
// present-link share affordance when one lands). They mint the SAME `?sp=` param the standalone route
// uses (docs-backend space_id), never the octo `?sid` token-bucket key.

/** Origin for a PPT link; empty under SSR / tests so the link degrades to a bare rooted path. */
function origin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
}

/**
 * Stamp the deck's owning space onto a rooted same-origin PPT path as `?sp=<space>`, preserving any
 * existing query params and hash. Used to append the space to the backend-forwarded editor link
 * (`/ppt/d/:docId`) so a created deck's link carries its space.
 *
 * - Returns `path` unchanged when `space` is empty/whitespace (no signal → let the interceptor decide,
 *   exactly as an in-shell entry does).
 * - Never OVERRIDES an `sp` the path already carries: if the backend already scoped the link, that
 *   authority wins and we leave it intact.
 */
export function withDeckSpace(path: string, space: string | null | undefined): string {
  const sp = (space ?? '').trim()
  if (!sp) return path
  const hashIdx = path.indexOf('#')
  const hash = hashIdx >= 0 ? path.slice(hashIdx) : ''
  const beforeHash = hashIdx >= 0 ? path.slice(0, hashIdx) : path
  const qIdx = beforeHash.indexOf('?')
  const base = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash
  const query = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : ''
  const params = new URLSearchParams(query)
  if (params.has('sp')) return path
  params.set('sp', sp)
  return `${base}?${params.toString()}${hash}`
}

export interface PptPresentLinkTarget {
  docId: string
  /** The deck's REAL owning space (docs-backend space_id), embedded as `?sp=` (optional). */
  space?: string
  /** Published version to present; omitted from the link when `'latest'` or absent (route defaults). */
  version?: 'latest' | number
}

/**
 * Build `${origin}/docs/:docId/present` — the present-route share form — carrying the deck's owning
 * space as `?sp=<space>` (so a cross-space recipient's cold open resolves the right `X-Space-Id`) and
 * an explicit `?version=<N>` only when a specific published version is pinned (`'latest'`/absent maps
 * to the route's own default, so it is left off). This is the present-route analogue of
 * `buildDocLink`; a present-link share affordance mints its link through here.
 */
export function buildPptPresentLink({ docId, space, version }: PptPresentLinkTarget): string {
  const path = `/docs/${encodeURIComponent(docId)}/present`
  const params = new URLSearchParams()
  const sp = (space ?? '').trim()
  if (sp) params.set('sp', sp)
  if (version !== undefined && version !== 'latest') params.set('version', String(version))
  const q = params.toString()
  return `${origin()}${path}${q ? `?${q}` : ''}`
}
