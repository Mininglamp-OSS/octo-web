// Link minting for the html_ppt peer surfaces (R3-F1, XIN-1495 / XIN-1583 / XIN-1621 / XIN-1630).
//
// P1-1 (round-5): `resolveDeckSpace()` (PptSurfacePage.tsx) reads a deep-link's dedicated `?sp=`
// carrier FIRST so a cross-space cold open resolves the deck's REAL space before the app shell has
// restored `currentSpaceId`. That read is only useful if something on the FE actually PRODUCES a PPT
// link carrying `?sp=` — and until this module, nothing did: ordinary `buildDocLink` deliberately
// mints `/d/:docId` without Space, while the peer editor link arrives from the backend
// `editorUrl` verbatim, and the present route had no minting site at all. So a cross-space share fell
// through to the recipient's last-visited space and 404'd on the backend cross-space guard.
//
// `withDeckSpace` is the PPT-route analogue of `buildDocLink`: it stamps the deck's owning space onto
// the `?sp=` carrier the PPT routes read, so a link the FE produces resolves the right `X-Space-Id` on
// a cross-space cold open. It is pure (only rewrites the query string) so it is unit-testable and
// reusable from any producer. It mints the PPT route's dedicated `?sp=` carrier (docs-backend
// space_id), never the octo `?sid` token-bucket key or an ordinary-document locator.
//
// SCOPE (round-6, XIN-1630 — honesty): the ONLY wired producer today is the create flow, which stamps
// the deck's space onto the backend-forwarded editor link (`/ppt/d/:docId?sp=`) via `withDeckSpace`
// (DocsHome.tsx). There is deliberately NO present-route link minter here: the present route
// (`/docs/:docId/present`) has no share affordance yet, so cross-space PRESENT-share remains
// unresolved and is left to a follow-up rather than shipped as a dead, uncalled builder described as
// wired. When a present-share affordance lands it should mint through a builder added here.

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
