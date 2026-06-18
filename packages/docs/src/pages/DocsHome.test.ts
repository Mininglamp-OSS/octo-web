import { describe, it, expect, afterEach, vi } from 'vitest'
import { resolveDocTarget } from './DocsHome.tsx'

// resolveDocTarget reads space/folder/doc from the URL query and falls back to the
// deployment-configured defaults (config.ts). With the default VITE_DOCS_DEFAULT_DOC unset,
// the configured default doc id is empty → no implicit doc, so an un-parameterised /docs
// returns null (empty state) rather than mounting against a non-existent document.
describe('resolveDocTarget', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns null when no doc is addressed and no default doc is configured', () => {
    // null target -> DocsHome renders the document list (GET /api/v1/docs) instead of
    // mounting an editor against a non-existent doc.
    expect(resolveDocTarget('')).toBeNull()
    expect(resolveDocTarget('?space=s1&folder=f1')).toBeNull()
  })

  it('reads space/folder/doc from the query string', () => {
    const t = resolveDocTarget('?space=sp1&folder=fd1&doc=d_real123')
    expect(t).toEqual({ space: 'sp1', folder: 'fd1', doc: 'd_real123', docId: 'd_real123' })
  })

  it('accepts docId as an alias for doc', () => {
    const t = resolveDocTarget('?docId=d_alias')
    expect(t).not.toBeNull()
    expect(t!.doc).toBe('d_alias')
    expect(t!.docId).toBe('d_alias')
  })

  it('falls back to default space/folder when only doc is provided', () => {
    const t = resolveDocTarget('?doc=d_only')
    expect(t).not.toBeNull()
    // defaults from config.ts: space='demo', folder='f_default'
    expect(t!.space).toBe('demo')
    expect(t!.folder).toBe('f_default')
    expect(t!.doc).toBe('d_only')
  })

  it('does not hardcode the non-existent d_welcome demo doc', () => {
    // Regression (2026-06-18): the editor hung on "Loading document…" because DocsHome
    // hardcoded doc='d_welcome', which exists in no DB. The default doc must be empty
    // (env-configurable) so an un-addressed /docs lists real documents instead.
    const t = resolveDocTarget('')
    expect(t).toBeNull()
  })
})
