import { describe, it, expect } from 'vitest'
import {
  backendModeFor,
  buildSourceUrl,
  PPT_SOURCE_BASE,
} from './pptSource.ts'

// Reconciliation with octo-docs-backend #161's real contract:
//   GET /api/v1/ppt/docs/:docId/source?mode=<published|live|draft>&version=<latest|N>&format=<bootstrap|bento|html>
// addressed BARE-RELATIVE on the shared apiClient (`/api/v1/` baseURL). These assert the finalized
// path + params and the FE→BE mode mapping, replacing the provisional `/ppt/frame` shape.

describe('backendModeFor — FE surface mode → backend mode vocabulary', () => {
  it('maps preview and present (read-only) to published, editor (writer/admin) to live', () => {
    expect(backendModeFor('preview')).toBe('published')
    expect(backendModeFor('present')).toBe('published')
    expect(backendModeFor('editor')).toBe('live')
  })
})

describe('buildSourceUrl — real backend source endpoint', () => {
  it('builds the bare-relative /ppt/docs/:id/source path with mode/version/format', () => {
    const url = buildSourceUrl({ docId: 'd_1', mode: 'preview', version: 'latest', format: 'html' })
    expect(url.startsWith(`${PPT_SOURCE_BASE}/d_1/source?`)).toBe(true)
    // No bespoke /ppt/frame host route anywhere in the URL.
    expect(url).not.toContain('/ppt/frame')
    const q = new URL(url, 'http://local').searchParams
    expect(q.get('mode')).toBe('published')
    expect(q.get('version')).toBe('latest')
    expect(q.get('format')).toBe('html')
  })

  it('carries the editor→live mapping but omits version (published-only per backend #161)', () => {
    const q = new URL(buildSourceUrl({ docId: 'd_1', mode: 'editor', version: 7, format: 'bento' }), 'http://local')
      .searchParams
    expect(q.get('mode')).toBe('live')
    // Backend #161 rejects an explicit `version` unless mode=published, so editor→live must not send it,
    // even when a concrete version is passed in.
    expect(q.has('version')).toBe(false)
    expect(q.get('format')).toBe('bento')
  })

  it('defaults format to html (the rendered source the live opaque-origin container mounts)', () => {
    const q = new URL(buildSourceUrl({ docId: 'd_1', mode: 'present', version: 'latest' }), 'http://local')
      .searchParams
    expect(q.get('format')).toBe('html')
    expect(q.get('mode')).toBe('published')
  })

  it('percent-encodes the docId', () => {
    const url = buildSourceUrl({ docId: 'a/b?c', mode: 'preview', version: 'latest' })
    expect(url).toContain(`${PPT_SOURCE_BASE}/a%2Fb%3Fc/source`)
  })

  // Backend octo-docs-backend #161 (deployed) rejects any explicit `version` unless mode=published
  // (parseVersion throws VALIDATION_ERROR/400). So the FE must serialize `version` ONLY for the
  // published modes (preview/present); editor→live must omit it entirely.
  describe('version is gated to published mode only (backend #161 "version is published-only")', () => {
    it('published modes (preview/present) DO carry version', () => {
      const preview = new URL(buildSourceUrl({ docId: 'd_1', mode: 'preview', version: 'latest' }), 'http://local')
        .searchParams
      expect(preview.get('mode')).toBe('published')
      expect(preview.get('version')).toBe('latest')

      const present = new URL(buildSourceUrl({ docId: 'd_1', mode: 'present', version: 3 }), 'http://local')
        .searchParams
      expect(present.get('mode')).toBe('published')
      expect(present.get('version')).toBe('3')
    })

    it('editor→live NEVER carries version, regardless of the version passed', () => {
      const latest = new URL(buildSourceUrl({ docId: 'd_1', mode: 'editor', version: 'latest' }), 'http://local')
        .searchParams
      expect(latest.get('mode')).toBe('live')
      expect(latest.has('version')).toBe(false)

      const numeric = new URL(buildSourceUrl({ docId: 'd_1', mode: 'editor', version: 9 }), 'http://local')
        .searchParams
      expect(numeric.get('mode')).toBe('live')
      expect(numeric.has('version')).toBe(false)
    })
  })
})
