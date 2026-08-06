import { describe, it, expect } from 'vitest'
import {
  backendModeFor,
  buildSourceUrl,
  buildPptBootstrap,
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

  it('carries the editor→live mapping and a numeric version', () => {
    const q = new URL(buildSourceUrl({ docId: 'd_1', mode: 'editor', version: 7, format: 'bento' }), 'http://local')
      .searchParams
    expect(q.get('mode')).toBe('live')
    expect(q.get('version')).toBe('7')
    expect(q.get('format')).toBe('bento')
  })

  it('defaults format to the bootstrap container-handshake payload', () => {
    const q = new URL(buildSourceUrl({ docId: 'd_1', mode: 'present', version: 'latest' }), 'http://local')
      .searchParams
    expect(q.get('format')).toBe('bootstrap')
    expect(q.get('mode')).toBe('published')
  })

  it('percent-encodes the docId', () => {
    const url = buildSourceUrl({ docId: 'a/b?c', mode: 'preview', version: 'latest' })
    expect(url).toContain(`${PPT_SOURCE_BASE}/a%2Fb%3Fc/source`)
  })
})

describe('buildPptBootstrap — payload for the origin-checked handshake', () => {
  it('carries the FE mode and a real backend rendered-source URL (format=bento)', () => {
    const bootstrap = buildPptBootstrap({ docId: 'd_1', mode: 'editor', version: 'latest', canEdit: true })
    expect(bootstrap.mode).toBe('editor')
    expect(bootstrap.docId).toBe('d_1')
    expect(bootstrap.canEdit).toBe(true)
    expect(bootstrap.sourceUrl).toContain(`${PPT_SOURCE_BASE}/d_1/source`)
    expect(bootstrap.sourceUrl).not.toContain('/ppt/frame')
    const q = new URL(bootstrap.sourceUrl, 'http://local').searchParams
    expect(q.get('mode')).toBe('live')
    expect(q.get('format')).toBe('bento')
  })

  it('defaults canEdit to false for a read-only context', () => {
    expect(buildPptBootstrap({ docId: 'd_1', mode: 'preview', version: 'latest' }).canEdit).toBe(false)
  })
})
