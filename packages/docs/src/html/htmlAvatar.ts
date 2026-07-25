// Shared helper: uid → octo-server avatar URL for the read-only HTML doc surface.
//
// Pulled out of HtmlDocCommentPanel so both the comment rail (per-comment author avatar) and the
// HtmlDocView header ≡ menu (creator avatar) resolve avatars via the same fallback path — the
// same-origin `/api/v1/users/<uid>/avatar` endpoint the collaborator avatars already use.
// Consumers stack their own preferred source (backend-supplied avatar_url etc.) in front of this;
// this helper only handles the uid → URL branch and returns null when there is no usable uid so
// the caller can fall back to an initial-letter chip.

import { getWKApp } from '../octoweb/index.ts'

/**
 * Turn a raw uid into the `/api/v1/users/<uid>/avatar` URL. Strips the Space-scoped `s<spaceId>_`
 * prefix (mirrors WKApp.avatarUser handling of person channel ids) so `s5_alice` still resolves
 * to `alice`. Returns null when the uid is empty/whitespace after trimming so the caller can pick
 * the initial-letter fallback without a truthy string that would trigger a broken <img>.
 */
export function avatarUrlForUid(uid?: string | null): string | null {
  let id = uid?.trim()
  if (!id) return null
  const spaceId = getWKApp().shared?.currentSpaceId
  if (spaceId && id.startsWith(`s${spaceId}_`)) {
    id = id.substring(spaceId.length + 2)
  }
  if (!id) return null
  return `/api/v1/users/${encodeURIComponent(id)}/avatar`
}
