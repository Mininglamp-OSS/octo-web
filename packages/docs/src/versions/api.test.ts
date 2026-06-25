import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import {
  listVersions,
  createNamedVersion,
  getVersionState,
  restoreVersion,
  renameVersion,
  deleteVersion,
  VersionSchemaIncompatibleError,
  VersionSchemaNewerError,
} from './api.ts'
// Reuse the shared canonical fixtures so this suite and the wire contract test
// assert against one source of truth instead of re-inventing the wire shape.
import { FIXTURE_LIST_RESPONSE, FIXTURE_RESTORE_RESPONSE } from './contract.fixtures.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('version API — paths / methods / mapping (feature #4 §7)', () => {
  it('GET list maps numeric kind -> string union and passes cursor/limit', async () => {
    api.responder = () => ({ data: FIXTURE_LIST_RESPONSE, status: 200 })
    const res = await listVersions('d_1', { cursor: 9, limit: 25 })
    expect(api.calls[0]).toMatchObject({ method: 'get' })
    expect(api.calls[0].url).toBe('/docs/d_1/versions?cursor=9&limit=25')
    expect(res.items.map((v) => v.kind)).toEqual(['named', 'auto', 'restore-marker'])
    expect(res.items[2].restoredFrom).toBe(2)
    expect(res.nextCursor).toBe(5)
  })

  it('GET list omits the query string when no cursor/limit given', async () => {
    api.responder = () => ({ data: { items: [], nextCursor: null }, status: 200 })
    const res = await listVersions('d_1')
    expect(api.calls[0].url).toBe('/docs/d_1/versions')
    expect(res.nextCursor).toBeNull()
  })

  it('GET list sends kind=manual / kind=auto and parses the counts object', async () => {
    const counts = { auto: 5, manual: 2, restore: 1, total: 8 }
    api.responder = () => ({ data: { ...FIXTURE_LIST_RESPONSE, counts }, status: 200 })

    const manual = await listVersions('d_1', { kind: 'manual', limit: 25 })
    expect(api.calls[0].url).toBe('/docs/d_1/versions?limit=25&kind=manual')
    expect(manual.counts).toEqual(counts)

    const auto = await listVersions('d_1', { kind: 'auto', cursor: 9 })
    expect(api.calls[1].url).toBe('/docs/d_1/versions?cursor=9&kind=auto')
    expect(auto.counts).toEqual(counts)
  })

  it('GET list leaves counts undefined on a legacy payload without it', async () => {
    api.responder = () => ({ data: FIXTURE_LIST_RESPONSE, status: 200 })
    const res = await listVersions('d_1', { kind: 'manual' })
    expect(res.counts).toBeUndefined()
  })

  it('POST create named version sends trimmed label, returns docVersionSeq', async () => {
    api.responder = () => ({ data: { docVersionSeq: 42 }, status: 200 })
    const seq = await createNamedVersion('d_1', '  milestone  ')
    expect(seq).toBe(42)
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/versions',
      body: { label: 'milestone' },
    })
  })

  it('POST create with no/blank label sends an empty body', async () => {
    api.responder = () => ({ data: { docVersionSeq: 1 }, status: 200 })
    await createNamedVersion('d_1', '   ')
    expect(api.calls[0]).toMatchObject({ method: 'post', url: '/docs/d_1/versions', body: {} })
  })

  it('GET state requests JSON and returns the decoded PM document + schema meta', async () => {
    const stateBody = {
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      schemaVersion: 13,
      docVersionSeq: 7,
    }
    let seenConfig: Record<string, unknown> | undefined
    api.responder = (_m, _u, _b, config) => {
      seenConfig = config as Record<string, unknown> | undefined
      return { data: stateBody, status: 200 }
    }
    const out = await getVersionState('d_1', 7)
    expect(out).toEqual(stateBody)
    expect(api.calls[0]).toMatchObject({ method: 'get', url: '/docs/d_1/versions/7/state' })
    // No longer an arraybuffer request — it is a normal JSON GET.
    expect(seenConfig?.responseType).toBeUndefined()
  })

  it('GET state maps 409 version_schema_incompatible to a typed error', async () => {
    api.responder = () => {
      throw { response: { status: 409, data: { error: 'version_schema_incompatible' } } }
    }
    await expect(getVersionState('d_1', 7)).rejects.toBeInstanceOf(VersionSchemaIncompatibleError)
  })

  it('GET state maps 409 version_schema_newer to a typed error', async () => {
    api.responder = () => {
      throw { response: { status: 409, data: { error: 'version_schema_newer' } } }
    }
    await expect(getVersionState('d_1', 7)).rejects.toBeInstanceOf(VersionSchemaNewerError)
  })

  it('POST restore returns { newDocVersionSeq, restoredFrom }', async () => {
    api.responder = () => ({ data: FIXTURE_RESTORE_RESPONSE, status: 200 })
    const res = await restoreVersion('d_1', 7)
    expect(res).toEqual({ newDocVersionSeq: 50, restoredFrom: 7 })
    expect(api.calls[0]).toMatchObject({ method: 'post', url: '/docs/d_1/versions/7/restore' })
  })

  it('restore maps 409 version_schema_incompatible to a typed error', async () => {
    api.responder = () => {
      throw { response: { status: 409, data: { error: 'version_schema_incompatible' } } }
    }
    await expect(restoreVersion('d_1', 7)).rejects.toBeInstanceOf(VersionSchemaIncompatibleError)
  })

  it('restore maps 409 version_schema_newer to a typed error', async () => {
    api.responder = () => {
      throw { response: { status: 409, data: { error: 'version_schema_newer' } } }
    }
    await expect(restoreVersion('d_1', 7)).rejects.toBeInstanceOf(VersionSchemaNewerError)
  })

  it('restore rethrows non-schema errors (e.g. 403)', async () => {
    api.responder = () => {
      throw { response: { status: 403, data: {} } }
    }
    await expect(restoreVersion('d_1', 7)).rejects.not.toBeInstanceOf(VersionSchemaIncompatibleError)
  })

  it('PATCH rename sends label to the version path', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    await renameVersion('d_1', 7, 'renamed')
    expect(api.calls[0]).toMatchObject({
      method: 'patch',
      url: '/docs/d_1/versions/7',
      body: { label: 'renamed' },
    })
  })

  it('DELETE removes the version row', async () => {
    api.responder = () => ({ data: {}, status: 204 })
    await deleteVersion('d_1', 7)
    expect(api.calls[0]).toMatchObject({ method: 'delete', url: '/docs/d_1/versions/7' })
  })
})
