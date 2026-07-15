// The canonical doc-share-link builder now lives in `@octo/base`
// (packages/dmworkbase/src/Utils/docLink.ts) as the single source of truth for the
// `${origin}/d/<docId>?sp=<spaceId>` format (XIN-450 / XIN-501 / XIN-513). This module stays as a
// thin re-export so existing docs-side imports (`./link.ts`) keep working; the full implementation
// and its rationale comment block live in the base util.

export { buildDocLink, type DocLinkTarget } from '@octo/base'
