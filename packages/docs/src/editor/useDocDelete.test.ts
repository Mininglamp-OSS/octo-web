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

  it('surfaces the forbidden error on 403 and keeps the doc', async () => {
    wk.apiClient.responder = () => {
      throw { response: { status: 403 } }
    }
    const onDeleted = vi.fn()
    const { result } = renderHook(() => useDocDelete('d_1', onDeleted))
    await act(async () => {
      await result.current.confirm()
    })
    expect(onDeleted).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.error).toBe('docs.doc.deleteForbidden'))
  })

  it('surfaces the archived error on 409', async () => {
    wk.apiClient.responder = () => {
      throw { response: { status: 409 } }
    }
    const { result } = renderHook(() => useDocDelete('d_1'))
    await act(async () => {
      await result.current.confirm()
    })
    expect(result.current.error).toBe('docs.doc.deleteArchived')
  })
})
