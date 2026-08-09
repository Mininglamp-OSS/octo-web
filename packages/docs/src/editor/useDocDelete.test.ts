import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { useDocDelete } from './useDocDelete.ts'

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  wk = createMockWKApp()
  setWKApp(wk)
})

afterEach(() => vi.restoreAllMocks())

describe('useDocDelete (Problem 4 — delete contract, relocated)', () => {
  it('opens and dismisses the confirm', () => {
    const { result } = renderHook(() => useDocDelete('d_1'))
    expect(result.current.confirming).toBe(false)
    act(() => result.current.requestDelete())
    expect(result.current.confirming).toBe(true)
    act(() => result.current.cancel())
    expect(result.current.confirming).toBe(false)
  })

  it('deletes (200) and calls onDeleted', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'delete' && url === '/docs/d_1') return { data: {}, status: 200 }
      return { data: {}, status: 200 }
    }
    const onDeleted = vi.fn()
    const { result } = renderHook(() => useDocDelete('d_1', onDeleted))
    await act(async () => {
      await result.current.confirm()
    })
    expect(onDeleted).toHaveBeenCalledWith('d_1')
    expect(result.current.error).toBeNull()
  })

  it('passes an explicit spaceId to the delete request', async () => {
    wk.apiClient.responder = () => ({ data: {}, status: 200 })
    const { result } = renderHook(() =>
      useDocDelete('d_1', undefined, { spaceId: 'space-doc' }),
    )
    await act(async () => {
      await result.current.confirm()
    })
    const call = wk.apiClient.calls.at(-1)!
    expect(call.method).toBe('delete')
    expect(call.config?.headers?.['X-Space-Id']).toBe('space-doc')
  })

  it('treats a 404 as already-gone (success, no error)', async () => {
    wk.apiClient.responder = () => {
      throw { response: { status: 404 } }
    }
    const onDeleted = vi.fn()
    const { result } = renderHook(() => useDocDelete('d_1', onDeleted))
    await act(async () => {
      await result.current.confirm()
    })
    expect(onDeleted).toHaveBeenCalledWith('d_1')
    expect(result.current.error).toBeNull()
  })

  it.each([
    [403, 'docs.doc.deleteForbidden'],
    [409, 'docs.doc.deleteArchived'],
    [500, 'docs.doc.deleteFailed'],
  ])('surfaces the shared error on %i and keeps the doc', async (status, errorKey) => {
    wk.apiClient.responder = () => {
      throw { response: { status } }
    }
    const onDeleted = vi.fn()
    const { result } = renderHook(() => useDocDelete('d_1', onDeleted))
    await act(async () => {
      await result.current.confirm()
    })
    expect(onDeleted).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.error).toBe(errorKey))
  })
})
