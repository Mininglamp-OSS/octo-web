import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import {
  undoAIChange,
  UndoVersionConflictError,
  UndoAlreadyUndoneError,
} from './htmlDocOperationsApi.ts'

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
  setWKApp(createMockWKApp({ uid: 'u_self', token: 't' }))
})
afterEach(() => {
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('htmlDocOperationsApi — undoAIChange (octo-doc data layer)', () => {
  it('POSTs to the operations/{id}/undo route with the expected_current_version body + token header', async () => {
    const spy = stubFetch(() =>
      jsonResponse({ data: { new_version: 13, base_version: 11, target_aid: 'a7', version: 13 } }),
    )
    const res = await undoAIChange('my-slug', 'op_abc', 12)

    const call = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(call[0])).toBe('https://od.test/v1/docs/my-slug/operations/op_abc/undo')
    expect(call[1].method).toBe('POST')
    expect((call[1].headers as Record<string, string>).token).toBe('t')
    expect(JSON.parse(String(call[1].body))).toEqual({ expected_current_version: 12 })
    // Maps the new version + base version + target aid back for the caller.
    expect(res).toEqual({ operationId: 'op_abc', baseVersion: 11, newVersion: 13, targetAid: 'a7' })
  })

  it('falls back to the generic `version` field when new_version is absent', async () => {
    stubFetch(() => jsonResponse({ data: { version: 20 } }))
    const res = await undoAIChange('s', 'op1', 19)
    expect(res.newVersion).toBe(20)
    expect(res.baseVersion).toBe(19) // falls back to expectedCurrentVersion
  })

  it('maps 409 version_conflict to UndoVersionConflictError', async () => {
    stubFetch(() => jsonResponse({ code: 'version_conflict' }, false, 409))
    await expect(undoAIChange('s', 'op1', 5)).rejects.toBeInstanceOf(UndoVersionConflictError)
  })

  it('maps 409 already_undone to UndoAlreadyUndoneError', async () => {
    stubFetch(() => jsonResponse({ code: 'already_undone' }, false, 409))
    await expect(undoAIChange('s', 'op1', 5)).rejects.toBeInstanceOf(UndoAlreadyUndoneError)
  })

  it('defaults an unlabeled 409 to a version conflict (safe: never a silent success)', async () => {
    stubFetch(() => jsonResponse({}, false, 409))
    await expect(undoAIChange('s', 'op1', 5)).rejects.toBeInstanceOf(UndoVersionConflictError)
  })

  it('rethrows a non-409 failure as a generic error', async () => {
    stubFetch(() => jsonResponse({}, false, 500))
    await expect(undoAIChange('s', 'op1', 5)).rejects.toThrow(/undoAIChange failed: 500/)
  })
})
