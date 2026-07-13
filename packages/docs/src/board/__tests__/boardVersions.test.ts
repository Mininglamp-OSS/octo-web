import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../../octoweb/mock.ts'
import { VersionSchemaIncompatibleError, VersionSchemaNewerError } from '../../versions/api.ts'
import { getBoardVersionState, versionErrorKey } from '../boardVersions.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('getBoardVersionState — decodes the board /state payload', () => {
  it('reads the board scene (elements + files) off the /state response', async () => {
    api.responder = () => ({
      data: {
        kind: 'board',
        scene: { elements: [{ id: 'a' }, { id: 'b' }], files: { f1: { mimeType: 'image/png' } } },
        schemaVersion: 3,
        docVersionSeq: 7,
      },
      status: 200,
    })
    const out = await getBoardVersionState('bd_1', 7)
    expect(api.calls[0]).toMatchObject({ method: 'get', url: '/docs/bd_1/versions/7/state' })
    expect(out.scene.elements).toHaveLength(2)
    expect(out.scene.files).toEqual({ f1: { mimeType: 'image/png' } })
    expect(out.schemaVersion).toBe(3)
    expect(out.docVersionSeq).toBe(7)
  })

  it('normalizes a malformed/empty scene to an empty board rather than throwing', async () => {
    api.responder = () => ({ data: { kind: 'board', scene: null }, status: 200 })
    const out = await getBoardVersionState('bd_1', 9)
    expect(out.scene.elements).toEqual([])
    expect(out.scene.files).toBeUndefined()
    expect(out.docVersionSeq).toBe(9) // falls back to the requested seq
  })

  it('propagates the typed 409 schema-newer error from the shared state call', async () => {
    api.responder = () => {
      throw { response: { status: 409, data: { error: 'version_schema_newer' } } }
    }
    await expect(getBoardVersionState('bd_1', 7)).rejects.toBeInstanceOf(VersionSchemaNewerError)
  })
})

describe('versionErrorKey — maps the board restore/preview failure surface', () => {
  const FALLBACK = 'docs.board.version.errRestore'

  it('maps typed schema errors', () => {
    expect(versionErrorKey(new VersionSchemaNewerError(), FALLBACK)).toBe('docs.board.version.errSchemaNewer')
    expect(versionErrorKey(new VersionSchemaIncompatibleError(), FALLBACK)).toBe(
      'docs.board.version.errSchemaIncompatible',
    )
  })

  it('maps 403 (access revoked / epoch changed) to the forbidden message', () => {
    expect(versionErrorKey({ response: { status: 403, data: { error: 'epoch_changed' } } }, FALLBACK)).toBe(
      'docs.board.version.errForbidden',
    )
  })

  it('maps 409 (conflict) to the conflict message', () => {
    expect(versionErrorKey({ response: { status: 409, data: { error: 'conflict' } } }, FALLBACK)).toBe(
      'docs.board.version.errConflict',
    )
  })

  it('maps 413 (payload too large) to the too-large message', () => {
    expect(versionErrorKey({ response: { status: 413, data: {} } }, FALLBACK)).toBe('docs.board.version.errTooLarge')
  })

  it('maps 404 (version gone) to the not-found message', () => {
    expect(versionErrorKey({ response: { status: 404 } }, FALLBACK)).toBe('docs.board.version.errNotFound')
  })

  it('falls back to the caller-supplied key for anything else', () => {
    expect(versionErrorKey(new Error('boom'), FALLBACK)).toBe(FALLBACK)
    expect(versionErrorKey({ response: { status: 500 } }, 'docs.board.version.errPreview')).toBe(
      'docs.board.version.errPreview',
    )
    expect(versionErrorKey(null, FALLBACK)).toBe(FALLBACK)
  })
})
