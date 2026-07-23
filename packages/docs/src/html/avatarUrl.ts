// Resolve an octo-server avatar URL from a raw user uid. Shared by comment authors
// (HtmlDocCommentPanel) and the doc header creator (DocMoreMenu via HtmlDocView).
// Kept in one place so the Space-prefix stripping stays consistent — both surfaces
// route through the same-origin `/api/v1/users/<uid>/avatar` proxy.

import { getWKApp } from '../octoweb/index.ts'

/**
 * Build `/api/v1/users/<uid>/avatar` from a raw user uid. Strips the Space-scoped
 * `s<spaceId>_` prefix (mirrors WKApp.avatarUser()'s handling of person channel ids)
 * so we address the underlying user, not the Space-scoped alias. Returns null when
 * no uid is available — caller should fall back to the initial-letter chip.
 */
export function avatarUrlFromUid(uid?: string | null): string | null {
  let u = uid?.trim()
  if (!u) return null
  const spaceId = getWKApp().shared?.currentSpaceId
  if (spaceId && u.startsWith(`s${spaceId}_`)) {
    u = u.substring(spaceId.length + 2)
  }
  if (!u) return null
  return `/api/v1/users/${encodeURIComponent(u)}/avatar`
}
