import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { AccessRequest } from './api.ts'

// Mock the REST layer so we control exactly when each in-flight request resolves.
vi.mock('./api.ts', () => ({
  listPendingAccessRequests: vi.fn(),
  approveAccessRequest: vi.fn(),
  denyAccessRequest: vi.fn(),
}))

import { useAccessRequests } from './useAccessRequests.ts'
import { listPendingAccessRequests } from './api.ts'

const listMock = listPendingAccessRequests as unknown as ReturnType<typeof vi.fn>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  listMock.mockReset()
})

describe('useAccessRequests — stale async guard (#511 review 顺带项)', () => {
  it('discards an in-flight response once docId has changed', async () => {
    const docA = deferred<AccessRequest[]>()
    const docB = deferred<AccessRequest[]>()
    listMock
      .mockReturnValueOnce(docA.promise) // doc A — will resolve LATE with stale data
      .mockReturnValueOnce(docB.promise) // doc B — the current selection

    const { result, rerender } = renderHook(
      ({ docId }) => useAccessRequests(docId, true),
      { initialProps: { docId: 'A' } },
    )

    // Switch to doc B while A's fetch is still in flight.
    rerender({ docId: 'B' })

    // B resolves first with its own data → adopted.
    await act(async () => {
      docB.resolve([{ requestId: 'rB', uid: 'uB' }])
    })
    await waitFor(() =>
      expect(result.current.requests.map((r) => r.requestId)).toEqual(['rB']),
    )

    // A resolves LATE → must be dropped, not overwrite B's data.
    await act(async () => {
      docA.resolve([{ requestId: 'rA', uid: 'uA' }])
    })
    expect(result.current.requests.map((r) => r.requestId)).toEqual(['rB'])
    expect(result.current.count).toBe(1)
  })

  it('does not fetch when disabled and clears any prior list', async () => {
    listMock.mockResolvedValue([{ requestId: 'r1', uid: 'u1' }])
    const { result, rerender } = renderHook(
      ({ enabled }) => useAccessRequests('d1', enabled),
      { initialProps: { enabled: true } },
    )
    await waitFor(() => expect(result.current.count).toBe(1))

    rerender({ enabled: false })
    await waitFor(() => expect(result.current.requests).toEqual([]))
    expect(listMock).toHaveBeenCalledTimes(1)
  })
})
