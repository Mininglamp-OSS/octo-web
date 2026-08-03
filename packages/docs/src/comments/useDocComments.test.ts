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

describe('useDocComments — direct thread hydration', () => {
  it('adds a marker-selected root without walking detailed pages', async () => {
    api.responder = (_method, url) => url.endsWith('/9/thread')
      ? { data: thread(9, 'late'), status: 200 }
      : { data: { items: [thread(1, 'first')], nextCursor: 1 }, status: 200 }
    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(1))
    await act(async () => {
      await result.current.loadThread(9)
    })
    expect(result.current.threads.map((item) => item.id)).toEqual([1, 9])
    expect(api.calls.some((call) => call.url === '/docs/d_1/comments/9/thread')).toBe(true)
  })

  it('tracks concurrent thread loads independently and lets both install', async () => {
    const releases = new Map<number, (value: any) => void>()
    api.responder = (_method, url) => {
      const match = url.match(/comments\/(\d+)\/thread$/)
      if (!match) return { data: { items: [], nextCursor: null }, status: 200 }
      const id = Number(match[1])
      return new Promise((resolve) => releases.set(id, resolve))
    }
    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let first!: Promise<boolean | null>
    let second!: Promise<boolean | null>
    await act(async () => {
      first = result.current.loadThread(9)
      second = result.current.loadThread(10)
      await Promise.resolve()
    })
    expect([...result.current.loadingThreadIds].sort((a, b) => a - b)).toEqual([9, 10])
    await act(async () => {
      releases.get(10)!({ data: thread(10, 'ten'), status: 200 })
      releases.get(9)!({ data: thread(9, 'nine'), status: 200 })
      await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    })
    expect(result.current.threads.map((item) => item.id)).toEqual([9, 10])
    expect(result.current.loadingThreadIds.size).toBe(0)
  })

  it('keeps the newer same-thread request authoritative when responses finish out of order', async () => {
    const releases: Array<(value: any) => void> = []
    api.responder = (_method, url) => url.endsWith('/9/thread')
      ? new Promise((resolve) => releases.push(resolve))
      : { data: { items: [], nextCursor: null }, status: 200 }
    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let older!: Promise<boolean | null>
    let newer!: Promise<boolean | null>
    await act(async () => {
      older = result.current.loadThread(9)
      newer = result.current.loadThread(9)
      await Promise.resolve()
    })
    expect(result.current.loadingThreadIds.has(9)).toBe(true)

    await act(async () => {
      releases[0]({ data: thread(9, 'old'), status: 200 })
      await expect(older).resolves.toBeNull()
    })
    expect(result.current.loadingThreadIds.has(9)).toBe(true)
    expect(result.current.threads).toEqual([])

    await act(async () => {
      releases[1]({ data: thread(9, 'new'), status: 200 })
      await expect(newer).resolves.toBe(true)
    })
    expect(result.current.loadingThreadIds.has(9)).toBe(false)
    expect(result.current.threads).toEqual([thread(9, 'new')])
  })

  it('returns null and discards a thread response superseded by a newer refresh', async () => {
    let releaseThread!: (value: any) => void
    let listCount = 0
    api.responder = (_method, url) => {
      if (url.endsWith('/9/thread')) return new Promise((resolve) => { releaseThread = resolve })
      listCount += 1
      return { data: { items: listCount === 1 ? [] : [thread(2, 'fresh')], nextCursor: null }, status: 200 }
    }
    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    let pending!: Promise<boolean | null>
    await act(async () => {
      pending = result.current.loadThread(9)
      await Promise.resolve()
      await result.current.refresh()
    })
    await act(async () => {
      releaseThread({ data: thread(9, 'stale'), status: 200 })
      await expect(pending).resolves.toBeNull()
    })
    expect(result.current.threads.map((item) => item.id)).toEqual([2])
  })
})

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

  it('does not strand loading=true (deadlocking pagination) when a mutation is rejected mid-loadMore', async () => {
    // Race: a mutation is rejected exactly while a loadMore page fetch is in
    // flight. reconcile() (the failure fallback re-read) must NOT preempt the
    // loading-bearing token that loadMore owns — otherwise loadMore's
    // `finally { if (reqRef===token) setLoading(false) }` is skipped, reconcile
    // never resets loading, and the spinner stays true forever. With loading
    // stuck true, loadMore early-returns (`if (nextCursor==null || loading)`),
    // so pagination is dead for the rest of the session.
    let rows = [thread(1, 'a'), thread(2, 'b')]
    let getCount = 0
    let releaseLoadMore: (() => void) | null = null

    api.responder = (method: string) => {
      if (method === 'get') {
        getCount += 1
        // 1st GET = initial refresh; hand back a non-null cursor so loadMore is enabled.
        if (getCount === 1) return { data: { items: rows, nextCursor: 25 }, status: 200 }
        // 2nd GET = loadMore's page fetch — hold it pending until we release it,
        // AFTER the rejected delete has run reconcile().
        if (getCount === 2) {
          return new Promise((resolve) => {
            releaseLoadMore = () =>
              resolve({ data: { items: [thread(3, 'c')], nextCursor: 50 }, status: 200 })
          })
        }
        // Later GETs (reconcile, subsequent loadMore) resolve immediately.
        return { data: { items: rows, nextCursor: 50 }, status: 200 }
      }
      if (method === 'delete') {
        throw { response: { status: 403 } } // rejected; comment still exists
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(2))
    expect(result.current.nextCursor).toBe(25)

    // Kick off loadMore; its page GET is now pending (getCount === 2).
    let loadMorePromise: Promise<void>
    await act(async () => {
      loadMorePromise = result.current.loadMore()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    // While that page fetch is in flight, a delete is rejected → runMutation
    // catch → reconcile() runs.
    await act(async () => {
      await result.current.remove(1, false)
    })

    // Now let the in-flight loadMore GET resolve — its finally runs here.
    await act(async () => {
      releaseLoadMore!()
      await loadMorePromise
    })

    // Regression assertions: loading must settle back to false...
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.nextCursor).not.toBeNull()

    // ...and pagination must remain usable — a fresh loadMore must actually fire
    // a new GET rather than being swallowed by a stuck loading flag.
    const getsBefore = api.calls.filter((c) => c.method === 'get').length
    await act(async () => {
      await result.current.loadMore()
    })
    const getsAfter = api.calls.filter((c) => c.method === 'get').length
    expect(getsAfter).toBeGreaterThan(getsBefore)
  })

  it('does not overwrite a newer refresh result with reconcile’s stale snapshot when a mutation is rejected mid-reconcile', async () => {
    // S1/S2 stale-overwrite race (lml2468 byte-proven repro):
    //   S1=[1,2] visible → a rejected delete kicks off reconcile() whose GET
    //   hangs → meanwhile a newer refresh lands S2=[1,2,3] → the hung reconcile
    //   resolves with its stale S1 snapshot. reconcile MUST bail (a newer
    //   refresh preempted it, tracked via the shared reqRef) rather than
    //   setThreads([1,2]) over [1,2,3]; otherwise comment #3 vanishes from the
    //   UI until the next load. reconcile still must NOT touch loading here (that
    //   would re-introduce the loading-strand regression covered above).
    const S1 = [thread(1, 'a'), thread(2, 'b')]
    const S2 = [thread(1, 'a'), thread(2, 'b'), thread(3, 'c')]
    let getCount = 0
    let releaseReconcile: (() => void) | null = null

    api.responder = (method: string) => {
      if (method === 'get') {
        getCount += 1
        // 1st GET = initial refresh → S1.
        if (getCount === 1) return { data: { items: S1, nextCursor: null }, status: 200 }
        // 2nd GET = reconcile()'s re-read — hold it pending until AFTER the newer
        // refresh has landed S2, then resolve it with the now-stale S1 snapshot.
        if (getCount === 2) {
          return new Promise((resolve) => {
            releaseReconcile = () =>
              resolve({ data: { items: S1, nextCursor: null }, status: 200 })
          })
        }
        // 3rd GET = the newer refresh → resolves immediately with the fresher S2.
        return { data: { items: S2, nextCursor: null }, status: 200 }
      }
      if (method === 'delete') {
        throw { response: { status: 403 } } // rejected → runMutation catch → reconcile()
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(2))

    // Kick off the rejected delete; its reconcile() GET (getCount 2) is now
    // pending, so remove()'s promise stays unresolved.
    let removePromise: ReturnType<typeof result.current.remove>
    await act(async () => {
      removePromise = result.current.remove(1, false)
      await Promise.resolve()
    })
    await waitFor(() => expect(releaseReconcile).not.toBeNull())

    // A newer refresh lands the fresher S2=[1,2,3] while reconcile is still pending.
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.threads.map((t) => t.id)).toEqual([1, 2, 3])

    // Release reconcile's hung GET — it resolves with the stale S1 snapshot.
    await act(async () => {
      releaseReconcile!()
      await removePromise
    })

    // reconcile must have bailed (preempted by the newer refresh) — S2 stays
    // intact and the delete failure is still surfaced.
    expect(result.current.threads.map((t) => t.id)).toEqual([1, 2, 3])
    expect(result.current.error).toBe('Failed to delete comment.')
  })

  it('does not re-introduce a since-deleted row when an in-flight loadMore page completes after reconcile dropped it', async () => {
    // Phantom-row race (Jerry-Xin @98dd6762): the third, distinct race.
    //   1. loadMore() starts and captures a page that still contains comment #30.
    //   2. Deleting #30 returns 404 (the server had already soft-deleted it), so
    //      runMutation's catch runs reconcile(), which re-reads the authoritative
    //      list — now WITHOUT #30 — and installs it.
    //   3. The older loadMore()'s GET finally resolves and appends its captured
    //      page → #30 reappears as a phantom row.
    // reconcile deliberately does not bump reqRef (that would strand the loader's
    // spinner), so loadMore's reqRef guard still passes on completion. The fix is
    // an independent dataEpoch that reconcile bumps after installing authoritative
    // truth; the in-flight loadMore must see it changed and DROP its stale page
    // (while still clearing its own loading in finally).
    const page1 = [thread(1, 'a'), thread(2, 'b')]
    let getCount = 0
    let releaseLoadMore: (() => void) | null = null

    api.responder = (method: string) => {
      if (method === 'get') {
        getCount += 1
        // 1st GET = initial refresh: page 1 with a cursor so loadMore is enabled.
        if (getCount === 1) return { data: { items: page1, nextCursor: 25 }, status: 200 }
        // 2nd GET = loadMore's page fetch — held pending. Its page still contains
        // the about-to-be-deleted comment #30; released only AFTER reconcile runs.
        if (getCount === 2) {
          return new Promise((resolve) => {
            releaseLoadMore = () =>
              resolve({ data: { items: [thread(3, 'c'), thread(30, 'phantom')], nextCursor: 50 }, status: 200 })
          })
        }
        // 3rd GET = reconcile's re-read: authoritative page 1, #30 already gone.
        return { data: { items: page1, nextCursor: 25 }, status: 200 }
      }
      if (method === 'delete') {
        throw { response: { status: 404 } } // #30 already soft-deleted server-side
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(2))
    expect(result.current.nextCursor).toBe(25)

    // Kick off loadMore; its page GET (getCount 2) is now pending.
    let loadMorePromise: Promise<void>
    await act(async () => {
      loadMorePromise = result.current.loadMore()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    // While that page is in flight, deleting #30 is rejected 404 → reconcile()
    // runs to completion (getCount 3), installing the authoritative list w/o #30.
    await act(async () => {
      await result.current.remove(30, false)
    })
    expect(result.current.threads.map((t) => t.id)).toEqual([1, 2])

    // Now let the older loadMore GET resolve and append its stale page.
    await act(async () => {
      releaseLoadMore!()
      await loadMorePromise
    })

    // The phantom row must NOT reappear: the stale page is dropped on the epoch
    // check. loading settles back to false (loadMore still owns its finally).
    expect(result.current.threads.map((t) => t.id)).toEqual([1, 2])
    expect(result.current.threads.some((t) => t.id === 30)).toBe(false)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Failed to delete comment.')
  })

  it('returns an explicit failure result so composers can retain their drafts', async () => {
    const rows = [thread(1, 'a')]
    api.responder = (method: string) => {
      if (method === 'get') return { data: { items: rows, nextCursor: null }, status: 200 }
      if (method === 'post') throw { response: { status: 403 } }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(1))

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.createRoot({
        body: 'draft',
        anchorStart: 'anchor',
        anchorEnd: 'anchor',
      })
    })

    expect(mutationResult).toEqual({ ok: false, error: 'Failed to add comment.' })
    expect(result.current.error).toBe('Failed to add comment.')
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

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.reply(1, 'b')
    })

    expect(mutationResult).toEqual({ ok: true, error: null })
    expect(result.current.threads.map((t) => t.id)).toEqual([1, 2])
    expect(result.current.error).toBeNull()
  })
})
