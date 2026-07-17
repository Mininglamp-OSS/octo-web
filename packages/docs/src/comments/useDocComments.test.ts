import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { useDocComments } from './useDocComments.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

function thread(id: number, body: string) {
  return { id, parentId: null, body, replies: [] }
}

/** Build a responder that lists `items` for every GET and defers DELETE handling to `onDelete`. */
function withList(items: () => unknown[], onDelete: () => { data: unknown; status: number }) {
  return (method: string, url: string) => {
    if (method === 'get') return { data: { items: items(), nextCursor: null }, status: 200 }
    if (method === 'delete') return onDelete()
    return { data: {}, status: 200 }
  }
}

describe('useDocComments — delete reconciles UI with authoritative backend', () => {
  it('drops the row on a successful delete', async () => {
    let rows = [thread(1, 'a'), thread(2, 'b')]
    api.responder = withList(
      () => rows,
      () => {
        rows = rows.filter((r) => r.id !== 1) // server soft-deleted #1; list now filters it
        return { data: { id: 1 }, status: 200 }
      },
    )

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(2))

    await act(async () => {
      await result.current.remove(1, false)
    })

    expect(result.current.threads.map((t) => t.id)).toEqual([2])
    expect(result.current.error).toBeNull()
  })

  it('reconciles to server truth when the delete is rejected (e.g. 404 already-deleted) instead of leaving a stale row', async () => {
    // The comment was already soft-deleted server-side, so the list no longer
    // returns it and the DELETE is rejected with 404. The row must still leave
    // the UI — this is the "deleted but still visible" regression.
    let rows = [thread(1, 'a'), thread(2, 'b')]
    api.responder = withList(
      () => rows,
      () => {
        rows = rows.filter((r) => r.id !== 1) // it's gone from the authoritative list
        throw { response: { status: 404 } }
      },
    )

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(2))

    await act(async () => {
      await result.current.remove(1, false)
    })

    // Row reconciled away (re-read from backend) AND the failure is surfaced.
    expect(result.current.threads.map((t) => t.id)).toEqual([2])
    expect(result.current.error).toBe('Failed to delete comment.')
  })

  it('keeps the row and shows the error when the delete is genuinely rejected and the comment still exists (e.g. 403)', async () => {
    // Rejected without a server-side state change (permission denial): the
    // comment truly still exists, so it must stay — but the error is shown.
    const rows = [thread(1, 'a'), thread(2, 'b')]
    api.responder = withList(
      () => rows,
      () => {
        throw { response: { status: 403 } }
      },
    )

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(2))

    await act(async () => {
      await result.current.remove(1, false)
    })

    expect(result.current.threads.map((t) => t.id)).toEqual([1, 2])
    expect(result.current.error).toBe('Failed to delete comment.')
  })

  it('does not regress create/reply/resolve refresh on success', async () => {
    let rows = [thread(1, 'a')]
    api.responder = (method: string, url: string) => {
      if (method === 'get') return { data: { items: rows, nextCursor: null }, status: 200 }
      if (method === 'post') {
        rows = [...rows, thread(2, 'b')]
        return { data: { id: 2 }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(1))

    await act(async () => {
      await result.current.reply(1, 'b')
    })

    expect(result.current.threads.map((t) => t.id)).toEqual([1, 2])
    expect(result.current.error).toBeNull()
  })
})
