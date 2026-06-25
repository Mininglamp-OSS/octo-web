// Cross-repo version-history wire contract test.
//
// Unlike api.test.ts (which exercises the mapping/paths/error handling of each
// call), this suite locks the WIRE CONTRACT: it drives the real api.ts functions
// through the mock transport using the SHARED canonical fixtures (contract.fixtures.ts)
// and asserts the frontend sends/receives exactly the canonical field names. It
// also guards against drift — a backend that renames a field (the historical
// `id`/`name`/`safetyVersionId` mistake) is provably detected here.
//
// The backend repo mirrors these fixtures; keeping both sides asserting the same
// canonical shapes is what prevents the "both repos green, runtime broken" drift.

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
} from './api.ts'
import { VERSION_WIRE_FIELDS } from './contract.ts'
import {
  FIXTURE_CREATE_RESPONSE,
  FIXTURE_DRIFTED_LIST_RESPONSE,
  FIXTURE_DRIFTED_RESTORE_RESPONSE,
  FIXTURE_LIST_RESPONSE,
  FIXTURE_LIST_RESPONSE_LAST,
  FIXTURE_RESTORE_RESPONSE,
} from './contract.fixtures.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

describe('version wire contract — canonical field names (single source of truth)', () => {
  it('pins the exact canonical field-name set (drift guard)', () => {
    // If anyone renames a wire field on either side, this assertion changes and
    // forces a coordinated, intentional contract bump.
    expect(VERSION_WIRE_FIELDS).toEqual({
      docVersionSeq: 'docVersionSeq',
      kind: 'kind',
      label: 'label',
      createdBy: 'createdBy',
      createdAt: 'createdAt',
      sizeBytes: 'sizeBytes',
      schemaVersion: 'schemaVersion',
      restoredFrom: 'restoredFrom',
      newDocVersionSeq: 'newDocVersionSeq',
      nextCursor: 'nextCursor',
      cursor: 'cursor',
      limit: 'limit',
    })
  })

  it('every canonical list-row key is present on the golden fixture', () => {
    const row = FIXTURE_LIST_RESPONSE.items[0]
    for (const key of ['docVersionSeq', 'kind', 'label', 'createdBy', 'createdAt', 'sizeBytes', 'schemaVersion', 'restoredFrom'] as const) {
      expect(row).toHaveProperty(key)
    }
  })
})

describe('version wire contract — endpoints consume/produce canonical fixtures', () => {
  it('GET list parses the canonical list payload (docVersionSeq/label/restoredFrom)', async () => {
    api.responder = () => ({ data: FIXTURE_LIST_RESPONSE, status: 200 })
    const res = await listVersions('d_1', { cursor: 9, limit: 25 })
    // Query uses canonical pagination param names.
    expect(api.calls[0].url).toBe(
      `/docs/d_1/versions?${VERSION_WIRE_FIELDS.cursor}=9&${VERSION_WIRE_FIELDS.limit}=25`,
    )
    // Canonical identifier + label survive into the parsed model.
    expect(res.items.map((v) => v.docVersionSeq)).toEqual([7, 6, 5])
    expect(res.items.map((v) => v.label)).toEqual(['milestone v1', '', 'restored from #2'])
    expect(res.items.map((v) => v.kind)).toEqual(['named', 'auto', 'restore-marker'])
    expect(res.items[2].restoredFrom).toBe(2)
    expect(res.nextCursor).toBe(5)
  })

  it('GET list parses the canonical "history exhausted" payload', async () => {
    api.responder = () => ({ data: FIXTURE_LIST_RESPONSE_LAST, status: 200 })
    const res = await listVersions('d_1')
    expect(res.items).toEqual([])
    expect(res.nextCursor).toBeNull()
  })

  it('POST create sends canonical { label } and reads canonical { docVersionSeq }', async () => {
    api.responder = () => ({ data: FIXTURE_CREATE_RESPONSE, status: 200 })
    const seq = await createNamedVersion('d_1', 'milestone v1')
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/versions',
      body: { [VERSION_WIRE_FIELDS.label]: 'milestone v1' },
    })
    expect(seq).toBe(FIXTURE_CREATE_RESPONSE.docVersionSeq)
  })

  it('GET state hits the canonical docVersionSeq path and parses JSON { doc, schemaVersion, docVersionSeq }', async () => {
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
    // Contract switched from octet-stream to JSON — no arraybuffer responseType.
    expect(seenConfig?.responseType).toBeUndefined()
  })

  it('POST restore reads canonical { newDocVersionSeq, restoredFrom }', async () => {
    api.responder = () => ({ data: FIXTURE_RESTORE_RESPONSE, status: 200 })
    const res = await restoreVersion('d_1', 7)
    expect(res).toEqual({
      [VERSION_WIRE_FIELDS.newDocVersionSeq]: 50,
      [VERSION_WIRE_FIELDS.restoredFrom]: 7,
    })
    expect(api.calls[0]).toMatchObject({ method: 'post', url: '/docs/d_1/versions/7/restore' })
  })

  it('PATCH rename sends canonical { label }', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    await renameVersion('d_1', 7, 'renamed')
    expect(api.calls[0]).toMatchObject({
      method: 'patch',
      url: '/docs/d_1/versions/7',
      body: { [VERSION_WIRE_FIELDS.label]: 'renamed' },
    })
  })

  it('DELETE hits the canonical docVersionSeq path', async () => {
    api.responder = () => ({ data: {}, status: 204 })
    await deleteVersion('d_1', 7)
    expect(api.calls[0]).toMatchObject({ method: 'delete', url: '/docs/d_1/versions/7' })
  })
})

describe('version wire contract — drift guards (a non-canonical backend is detected)', () => {
  it('a list payload with id/name instead of docVersionSeq/label yields broken parse', async () => {
    api.responder = () => ({ data: FIXTURE_DRIFTED_LIST_RESPONSE, status: 200 })
    const res = await listVersions('d_1')
    // The canonical fields are absent on the drifted wire, so the parsed model is
    // missing its identifier and label — the exact runtime breakage the contract
    // test exists to catch before it ships.
    expect(res.items[0].docVersionSeq).toBeUndefined()
    expect(res.items[0].label).toBeUndefined()
    // The legacy field name does not leak through under the canonical key.
    expect((res.items[0] as unknown as Record<string, unknown>).id).toBe(7)
  })

  it('a restore payload with safetyVersionId/restoredFromVersionId yields broken parse', async () => {
    api.responder = () => ({ data: FIXTURE_DRIFTED_RESTORE_RESPONSE, status: 200 })
    const res = await restoreVersion('d_1', 7)
    expect(res.newDocVersionSeq).toBeUndefined()
    expect(res.restoredFrom).toBeUndefined()
  })
})
