// Shareable links for drive shares and space invites.
//
// Both carry their token in the PATH (not the query) under the `/drive`
// namespace, mirroring @octo/base buildDocLink (`/d/:docId`) and the docs
// module's invite link (`/docs/invite/:token`): the octo host's RouteManager
// re-pushes pathname-only and strips the query, so a `?token=` deep-link would
// be wiped before the module mounts. The share id doubles as its access token
// (drive backend keys `POST /v1/drive/shares/:id/access` on the share id);
// invites carry their own opaque token.
//
// The landing routes (`/drive/s/:id`, `/drive/invite/:token`) are registered
// via the octo host Layout. Both REQUIRE a signed-in Octo session: a logged-out
// visitor who opens the link is sent to login and returned to the landing after
// signing in (login-then-return). The value delivered here is a copyable
// token-bearing URL.

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

/**
 * Decode a path segment, tolerating a malformed %-escape (returns '' instead).
 *
 * `decodeURIComponent('%')` (or any bad escape like `%zz`) throws a URIError.
 * The token readers below run during module init — BEFORE React mounts — so an
 * uncaught throw white-screens the whole SPA (even the login page). Treat an
 * undecodable token as "no token".
 */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

/** Read the share token from a `/drive/s/:id` pathname ('' if none/malformed). */
export function shareTokenFromPath(): string {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/\/drive\/s\/([^/?#]+)/);
  return m ? safeDecode(m[1]) : '';
}

/** Read the invite token from a `/drive/invite/:token` pathname ('' if none/malformed). */
export function inviteTokenFromPath(): string {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/\/drive\/invite\/([^/?#]+)/);
  return m ? safeDecode(m[1]) : '';
}

/**
 * Whether `pathname` is a drive share landing link (`/drive/s/:token`).
 * The host Layout intercepts this shape and renders ShareLandingPage (which
 * requires a signed-in session; a logged-out visitor is bounced to login and
 * returned here). Anchored to a single token segment, and the token must
 * survive safeDecode — a malformed %-escape or an encoded slash is rejected so
 * Layout never renders the page with an empty/ambiguous token that would POST to
 * `/shares//access`. Mirrors isSafeDriveLandingPath in the host allowlist.
 */
export function isDriveSharePath(pathname: string): boolean {
  return isLandingToken(pathname, /^\/drive\/s\/([^/?#]+)\/?$/);
}

/** Whether `pathname` is a space-invite landing link (`/drive/invite/:token`). */
export function isDriveInvitePath(pathname: string): boolean {
  return isLandingToken(pathname, /^\/drive\/invite\/([^/?#]+)\/?$/);
}

/**
 * Match a single-segment landing path and require the token to be a decodable,
 * unambiguous segment: a malformed %-escape (`safeDecode` → '') or an encoded
 * slash (`%2F` → '/', smuggling a second segment) is rejected.
 */
function isLandingToken(pathname: string, re: RegExp): boolean {
  const m = re.exec(pathname);
  if (!m) return false;
  const decoded = safeDecode(m[1]);
  return decoded !== '' && !decoded.includes('/');
}
