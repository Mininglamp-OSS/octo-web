// Shareable links for drive shares and space invites.
//
// Both carry their token in the PATH (not the query) under the `/drive`
// namespace, mirroring @octo/base buildDocLink (`/d/:docId`) and the docs
// module's invite link (`/docs/invite/:token`): the octo host's RouteManager
// re-pushes pathname-only and strips the query, so a `?token=` deep-link would
// be wiped before the module mounts. The share id doubles as its public-access
// token (drive backend keys `POST /v1/drive/public/shares/:id/access` on the
// share id); invites carry their own opaque token.
//
// P1 note: the landing routes (`/drive/s/:id`, `/drive/invite/:token`) are not
// registered yet — the value delivered here is a copyable token-bearing URL.
// Accept/landing pages are tracked for a later task.

function origin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
}

/** `${origin}/drive/s/<shareId>` — the share id is the public-access token. */
export function buildShareLink(shareId: string): string {
  return `${origin()}/drive/s/${encodeURIComponent(shareId)}`;
}

/** `${origin}/drive/invite/<token>` — pairs with acceptInvite(token). */
export function buildInviteLink(token: string): string {
  return `${origin()}/drive/invite/${encodeURIComponent(token)}`;
}
