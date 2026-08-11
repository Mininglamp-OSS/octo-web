import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { useDocComments, COMMENT_POLL_INTERVAL_MS } from './useDocComments.ts'

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
    expect(result.current.error).toBe('docs.comment.errors.delete.notFound')
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
    expect(result.current.error).toBe('docs.comment.errors.delete.forbidden')
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
    expect(result.current.error).toBe('docs.comment.errors.delete.forbidden')
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
    expect(result.current.error).toBe('docs.comment.errors.delete.notFound')
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

    expect(mutationResult).toEqual({
      ok: false,
      error: 'docs.comment.errors.add.forbidden',
      status: 403,
    })
    expect(result.current.error).toBe('docs.comment.errors.add.forbidden')
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

describe('useDocComments — pagination-preserving recovery refresh', () => {
  function range(from: number, to: number, prefix: string) {
    return Array.from({ length: to - from + 1 }, (_, index) => {
      const id = from + index
      return thread(id, `${prefix}-${id}`)
    })
  }

  it('finds a larger-id comment created after a full loaded page while disconnected', async () => {
    let rows = range(1, 25, 'old')
    api.responder = (_method, url) => {
      const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
      const items = rows.filter((item) => item.id > cursor).slice(0, 25)
      return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    rows = [...rows, thread(26, 'created-offline')]

    const callsBefore = api.calls.length
    await act(async () => { await result.current.refresh() })

    const recoveryCalls = api.calls.slice(callsBefore).filter((call) => call.method === 'get')
    expect(recoveryCalls).toHaveLength(2) // old page + bounded tail probe
    expect(result.current.threads.map((item) => item.id)).toEqual(range(1, 26, 'unused').map((item) => item.id))
    expect(result.current.threads.at(-1)?.body).toBe('created-offline')
    expect(result.current.nextCursor).toBeNull()
  })

  it('finds a larger-id comment after two full loaded pages and preserves further load-more', async () => {
    let rows = range(1, 75, 'old')
    api.responder = (_method, url) => {
      const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
      const items = rows.filter((item) => item.id > cursor).slice(0, 25)
      return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.threads).toHaveLength(50)
    rows = [...rows, thread(76, 'created-offline')]

    await act(async () => { await result.current.refresh() })
    expect(result.current.threads.map((item) => item.id)).toEqual(range(1, 75, 'unused').map((item) => item.id))
    // The bounded probe is full, so deeper content (including #76) remains reachable via Load more.
    expect(result.current.nextCursor).toBe(75)
    await act(async () => { await result.current.loadMore() })
    expect(result.current.threads.at(-1)?.id).toBe(76)
    expect(result.current.threads.at(-1)?.body).toBe('created-offline')
  })

  it('keeps the durable user-loaded depth stable across repeated tail-probe refreshes', async () => {
    const rows = range(1, 76, 'row')
    api.responder = (_method, url) => {
      const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
      const items = rows.filter((item) => item.id > cursor).slice(0, 25)
      return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.threads).toHaveLength(50)

    for (let refreshIndex = 0; refreshIndex < 3; refreshIndex++) {
      const callsBefore = api.calls.length
      await act(async () => { await result.current.refresh() })
      const calls = api.calls.slice(callsBefore).filter((call) => call.method === 'get')
      expect(calls).toHaveLength(3) // 2 user-loaded pages + 1 transient probe, every time
      expect(result.current.threads).toHaveLength(75)
      expect(result.current.nextCursor).toBe(75)
    }

    // Probe pages did not inflate the baseline: one user Load more advances from cursor 75 only.
    await act(async () => { await result.current.loadMore() })
    expect(result.current.threads.at(-1)?.id).toBe(76)
  })

  it('keeps the newer recovery authoritative when same-ID responses finish out of order', async () => {
    let getCount = 0
    let releaseOlder!: (value: any) => void
    api.responder = (method) => {
      if (method !== 'get') return { data: {}, status: 200 }
      getCount++
      if (getCount === 1) return { data: { items: [thread(1, 'initial')], nextCursor: null }, status: 200 }
      if (getCount === 2) return new Promise((resolve) => { releaseOlder = resolve })
      return { data: { items: [thread(1, 'newer')], nextCursor: null }, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads[0]?.body).toBe('initial'))
    let older!: Promise<void>
    await act(async () => {
      older = result.current.refresh()
      await Promise.resolve()
      await result.current.refresh()
    })
    expect(result.current.threads[0]?.body).toBe('newer')
    expect(result.current.loading).toBe(false)

    await act(async () => {
      releaseOlder({ data: { items: [thread(1, 'older')], nextCursor: null }, status: 200 })
      await older
    })
    expect(result.current.threads[0]?.body).toBe('newer')
    expect(result.current.loading).toBe(false)
  })
})

describe('useDocComments — atomic recovery failure', () => {
  it('keeps old threads, cursor, and page depth when the tail probe fails', async () => {
    let recovery = false
    api.responder = (_method, url) => {
      const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
      if (!recovery) {
        if (cursor === 25) return { data: { items: [thread(26, 'old-26')], nextCursor: null }, status: 200 }
        return { data: { items: Array.from({ length: 25 }, (_, i) => thread(i + 1, `old-${i + 1}`)), nextCursor: 25 }, status: 200 }
      }
      if (cursor === 26) throw new Error('offline during tail probe')
      if (cursor === 25) return { data: { items: [thread(26, 'new-26')], nextCursor: 26 }, status: 200 }
      return { data: { items: Array.from({ length: 25 }, (_, i) => thread(i + 1, `new-${i + 1}`)), nextCursor: 25 }, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.nextCursor).toBe(25))
    await act(async () => { await result.current.loadMore() })
    const oldThreads = result.current.threads
    expect(result.current.nextCursor).toBeNull()

    recovery = true
    await act(async () => { await result.current.refresh() })
    expect(result.current.threads).toBe(oldThreads)
    expect(result.current.threads.at(-1)?.body).toBe('old-26')
    expect(result.current.nextCursor).toBeNull()
    expect(result.current.error).toBe('Failed to load comments.')
    expect(result.current.loading).toBe(false)
  })
})

describe('useDocComments — failed mutation preserves loaded depth', () => {
  it('keeps scope and displayed depth atomic when the replacement scope initially fails', async () => {
    const unresolvedRows = Array.from({ length: 50 }, (_, index) => thread(index + 1, `old-${index + 1}`))
    const resolvedRows = Array.from({ length: 50 }, (_, index) => thread(index + 101, `new-${index + 101}`))
    let resolvedPhase: 'scope-refresh-fails' | 'reconcile-second-page-fails' | 'scope-refresh-succeeds' = 'scope-refresh-fails'
    api.responder = (method, url) => {
      if (method === 'delete') throw { response: { status: 403 } }
      if (method === 'get') {
        const parsed = new URL(`https://octo.test${url}`)
        const includeResolved = parsed.searchParams.get('includeResolved') === '1'
        const cursor = Number(parsed.searchParams.get('cursor') ?? 0)
        if (includeResolved && resolvedPhase === 'scope-refresh-fails') {
          resolvedPhase = 'reconcile-second-page-fails'
          throw new Error('scope replacement failed')
        }
        if (includeResolved && resolvedPhase === 'reconcile-second-page-fails' && cursor === 125) {
          resolvedPhase = 'scope-refresh-succeeds'
          throw new Error('reconcile failed on its second page')
        }
        const rows = includeResolved ? resolvedRows : unresolvedRows
        const items = rows.filter((item) => item.id > cursor).slice(0, 25)
        return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    await act(async () => { await result.current.loadMore() })
    const oldThreads = result.current.threads
    const oldCursor = result.current.nextCursor
    expect(oldThreads).toHaveLength(50)

    act(() => result.current.setIncludeResolved(true))
    await waitFor(() => expect(result.current.error).toBe('Failed to load comments.'))
    expect(result.current.threads).toBe(oldThreads)
    expect(result.current.nextCursor).toBe(oldCursor)

    // The failed scope transition must not reset displayed depth before replacement data installs.
    // A rejected mutation therefore reconciles the complete two-page window, not one page.
    const reconcileGetsBefore = api.calls.filter((call) => call.method === 'get').length
    await act(async () => { await result.current.remove(101, false) })
    expect(api.calls.filter((call) => call.method === 'get').length - reconcileGetsBefore).toBe(2)
    expect(result.current.threads).toBe(oldThreads)
    expect(result.current.nextCursor).toBe(oldCursor)

    // Neither failed request committed the pending scope transition. The next successful scope
    // refresh starts from one page and atomically normalizes installed data and pagination metadata.
    const refreshGetsBefore = api.calls.filter((call) => call.method === 'get').length
    await act(async () => { await result.current.refresh() })
    expect(api.calls.filter((call) => call.method === 'get').length - refreshGetsBefore).toBe(1)
    expect(result.current.threads).toHaveLength(25)
    expect(result.current.threads[0]?.id).toBe(101)
    expect(result.current.nextCursor).toBe(125)
  })

  it('commits a replacement scope when reconcile succeeds after the scope refresh failed', async () => {
    const unresolvedRows = Array.from({ length: 50 }, (_, index) => thread(index + 1, `old-${index + 1}`))
    const resolvedRows = Array.from({ length: 75 }, (_, index) => thread(index + 101, `new-${index + 101}`))
    let failScopeRefresh = true
    api.responder = (method, url) => {
      if (method === 'delete') throw { response: { status: 403 } }
      if (method === 'get') {
        const parsed = new URL(`https://octo.test${url}`)
        const includeResolved = parsed.searchParams.get('includeResolved') === '1'
        if (includeResolved && failScopeRefresh) {
          failScopeRefresh = false
          throw new Error('scope replacement failed')
        }
        const cursor = Number(parsed.searchParams.get('cursor') ?? 0)
        const rows = includeResolved ? resolvedRows : unresolvedRows
        const items = rows.filter((item) => item.id > cursor).slice(0, 25)
        return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.threads).toHaveLength(50)

    act(() => result.current.setIncludeResolved(true))
    await waitFor(() => expect(result.current.error).toBe('Failed to load comments.'))
    expect(result.current.threads[0]?.id).toBe(1)

    const reconcileGetsBefore = api.calls.filter((call) => call.method === 'get').length
    await act(async () => { await result.current.remove(101, false) })
    expect(api.calls.filter((call) => call.method === 'get').length - reconcileGetsBefore).toBe(2)
    expect(result.current.threads).toHaveLength(50)
    expect(result.current.threads[0]?.id).toBe(101)
    expect(result.current.nextCursor).toBe(150)

    // Successful reconcile committed the replacement scope. Refresh therefore preserves the two
    // displayed pages, rather than treating it as another new scope and collapsing to one page.
    const firstRefreshGetsBefore = api.calls.filter((call) => call.method === 'get').length
    await act(async () => { await result.current.refresh() })
    expect(api.calls.filter((call) => call.method === 'get').length - firstRefreshGetsBefore).toBe(2)
    expect(result.current.threads).toHaveLength(50)
    expect(result.current.nextCursor).toBe(150)

    // Durable depth was normalized to one, so the replacement window remains bounded at two pages.
    const secondRefreshGetsBefore = api.calls.filter((call) => call.method === 'get').length
    await act(async () => { await result.current.refresh() })
    expect(api.calls.filter((call) => call.method === 'get').length - secondRefreshGetsBefore).toBe(2)
    expect(result.current.threads).toHaveLength(50)
  })

  it('keeps a displayed tail-probe page after a rejected mutation', async () => {
    const rows = Array.from({ length: 75 }, (_, index) => thread(index + 1, `row-${index + 1}`))
    api.responder = (method, url) => {
      if (method === 'delete') throw { response: { status: 403 } }
      if (method === 'get') {
        const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
        const items = rows.filter((item) => item.id > cursor).slice(0, 25)
        return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))

    await act(async () => { await result.current.refresh() })
    expect(result.current.threads).toHaveLength(50)
    expect(result.current.nextCursor).toBe(50)

    const getsBefore = api.calls.filter((call) => call.method === 'get').length
    let outcome
    await act(async () => { outcome = await result.current.remove(1, false) })

    expect(outcome).toMatchObject({ ok: false, status: 403 })
    expect(api.calls.filter((call) => call.method === 'get').length - getsBefore).toBe(2)
    expect(result.current.threads).toHaveLength(50)
    expect(result.current.nextCursor).toBe(50)

    // The displayed probe did not become durable refresh depth: another recovery remains bounded
    // to the same two-page window instead of probing a third page.
    const refreshGetsBefore = api.calls.filter((call) => call.method === 'get').length
    await act(async () => { await result.current.refresh() })
    expect(api.calls.filter((call) => call.method === 'get').length - refreshGetsBefore).toBe(2)
    expect(result.current.threads).toHaveLength(50)
  })

  it('reconciles the full user-loaded window atomically after a rejected mutation', async () => {
    let rows = Array.from({ length: 75 }, (_, index) => thread(index + 1, `old-${index + 1}`))
    api.responder = (method, url) => {
      if (method === 'delete') throw { response: { status: 403 } }
      if (method === 'get') {
        const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
        const items = rows.filter((item) => item.id > cursor).slice(0, 25)
        return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    await act(async () => { await result.current.loadMore() })
    await act(async () => { await result.current.loadMore() })
    expect(result.current.threads).toHaveLength(75)

    rows = rows.map((item) => item.id === 60 ? thread(60, 'server-new-60') : item)
    const getsBefore = api.calls.filter((call) => call.method === 'get').length
    let outcome
    await act(async () => { outcome = await result.current.remove(1, false) })

    expect(outcome).toMatchObject({ ok: false, status: 403 })
    expect(api.calls.filter((call) => call.method === 'get').length - getsBefore).toBe(3)
    expect(result.current.threads).toHaveLength(75)
    expect(result.current.threads.find((item) => item.id === 60)?.body).toBe('server-new-60')
    expect(result.current.nextCursor).toBe(75)
  })

  it('keeps the old multi-page window when a later reconcile page fails', async () => {
    let failReconcile = false
    const rows = Array.from({ length: 50 }, (_, index) => thread(index + 1, `old-${index + 1}`))
    api.responder = (method, url) => {
      if (method === 'delete') throw { response: { status: 403 } }
      if (method === 'get') {
        const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
        if (failReconcile && cursor === 25) throw new Error('offline between reconcile pages')
        const items = rows.filter((item) => item.id > cursor).slice(0, 25)
        return { data: { items, nextCursor: items.length === 25 ? items.at(-1)!.id : null }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    await act(async () => { await result.current.loadMore() })
    const oldThreads = result.current.threads
    const oldCursor = result.current.nextCursor

    failReconcile = true
    await act(async () => { await result.current.remove(1, false) })
    expect(result.current.threads).toBe(oldThreads)
    expect(result.current.nextCursor).toBe(oldCursor)
    expect(result.current.error).toBe('docs.comment.errors.delete.forbidden')
  })
})

describe('useDocComments — loadMore/reconcile completion ordering', () => {
  it('keeps the newer page, cursor, and durable depth when loadMore completes before an older reconcile', async () => {
    const rows = Array.from({ length: 75 }, (_, index) => thread(index + 1, `row-${index + 1}`))
    let phase: 'initial' | 'race' | 'stable' = 'initial'
    let releaseLoadMore: (() => void) | null = null
    let releaseReconcile: (() => void) | null = null

    api.responder = (method, url) => {
      if (method === 'delete') throw { response: { status: 403 } }
      if (method === 'get') {
        const cursor = Number(new URL(`https://octo.test${url}`).searchParams.get('cursor') ?? 0)
        const response = {
          data: { items: rows.filter((item) => item.id > cursor).slice(0, 25), nextCursor: cursor + 25 },
          status: 200,
        }
        if (phase === 'race' && cursor === 25) {
          return new Promise((resolve) => { releaseLoadMore = () => resolve(response) })
        }
        if (phase === 'race' && cursor === 0) {
          return new Promise((resolve) => { releaseReconcile = () => resolve(response) })
        }
        return response
      }
      return { data: {}, status: 200 }
    }

    const { result } = renderHook(() => useDocComments('d_1'))
    await waitFor(() => expect(result.current.threads).toHaveLength(25))
    expect(result.current.nextCursor).toBe(25)

    phase = 'race'
    let loadMorePromise: Promise<void>
    await act(async () => {
      loadMorePromise = result.current.loadMore()
      await Promise.resolve()
    })
    await waitFor(() => expect(releaseLoadMore).not.toBeNull())

    let removePromise: ReturnType<typeof result.current.remove>
    await act(async () => {
      removePromise = result.current.remove(1, false)
      await Promise.resolve()
    })
    await waitFor(() => expect(releaseReconcile).not.toBeNull())

    // The loading-bearing request wins first and raises durable depth from one page to two.
    await act(async () => {
      releaseLoadMore!()
      await loadMorePromise
    })
    expect(result.current.threads).toHaveLength(50)
    expect(result.current.nextCursor).toBe(50)
    await waitFor(() => expect(result.current.loading).toBe(false))

    // The older one-page reconcile must now be stale and cannot collapse the installed window.
    await act(async () => {
      releaseReconcile!()
      await removePromise
    })
    expect(result.current.threads).toHaveLength(50)
    expect(result.current.nextCursor).toBe(50)

    // A later reconcile proves the internal durable depth also stayed at two pages.
    phase = 'stable'
    const getsBefore = api.calls.filter((call) => call.method === 'get').length
    await act(async () => { await result.current.remove(2, false) })
    expect(api.calls.filter((call) => call.method === 'get').length - getsBefore).toBe(2)
    expect(result.current.threads).toHaveLength(50)
    expect(result.current.nextCursor).toBe(50)
      })
    })
    
describe('useDocComments — background poll picks up the Bot reply', () => {
  // 评论没有实时通道:正文走 CRDT,评论是挂载时拉一次的 REST 列表。可执行评论整条链路
  // 都是异步的(@Bot → 事件入队 → agent 干活 → 几十秒后 POST 回复),页面这边收不到任何
  // 通知。没有轮询的话,Bot 改完文档、评论也发了,用户还得手动开关一次侧栏才看得见 ——
  // 跟「Bot 没回」长得一模一样,当初就是这么被报上来的。
  //
  // 这几条用 `act(async () => {})` 冲洗微任务而不是 waitFor:@testing-library 的 waitFor
  // 靠 setInterval 反复重试,而这里正要假掉 setInterval 才能推进轮询 —— 两者不能共存。
  // mock apiClient 是同步的,冲一次微任务就够。
  const flush = () => act(async () => {})

  function withFakeInterval(): () => void {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    return () => vi.useRealTimers()
  }

  it('applies a comment that appeared server-side after mount', async () => {
    const restore = withFakeInterval()
    try {
      let rows = [thread(1, 'ask the bot')]
      api.responder = (method) =>
        method === 'get'
          ? { data: { items: rows, nextCursor: null }, status: 200 }
          : { data: {}, status: 200 }

      const { result } = renderHook(() => useDocComments('d_1'))
      await flush()
      expect(result.current.threads).toHaveLength(1)

      // Bot 在别处落了一条回复,本地没有任何写操作可以触发重读。
      rows = [thread(1, 'ask the bot'), thread(2, '已按要求改好')]
      await act(async () => {
        vi.advanceTimersByTime(COMMENT_POLL_INTERVAL_MS)
      })
      await flush()

      expect(result.current.threads.map((t) => t.id)).toEqual([1, 2])
      // 静默重读:轮询不得把面板的 spinner 打开,否则每 15 秒闪一次。
      expect(result.current.loading).toBe(false)
    } finally {
      restore()
    }
  })

  it('does not poll while the tab is hidden, and catches up on return', async () => {
    const restore = withFakeInterval()
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    try {
      api.responder = (method) =>
        method === 'get'
          ? { data: { items: [thread(1, 'a')], nextCursor: null }, status: 200 }
          : { data: {}, status: 200 }

      const { result } = renderHook(() => useDocComments('d_1'))
      await flush()
      expect(result.current.threads).toHaveLength(1)
      const afterMount = api.calls.length

      visibility.mockReturnValue('hidden')
      await act(async () => {
        vi.advanceTimersByTime(COMMENT_POLL_INTERVAL_MS * 3)
      })
      await flush()
      expect(api.calls.length).toBe(afterMount)

      // 切回前台立刻补一次,不用再等一个完整周期 —— 那正是内容最可能过期、也最显眼的时刻。
      visibility.mockReturnValue('visible')
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await flush()
      expect(api.calls.length).toBeGreaterThan(afterMount)
    } finally {
      visibility.mockRestore()
      restore()
    }
  })

  it('pauses polling once the reader has paginated past page 1', async () => {
    const restore = withFakeInterval()
    try {
      // reconcile 只重读第一页。翻过页的人被塌回顶部,比晚几秒看到新评论更糟。
      const page1 = Array.from({ length: 25 }, (_, i) => thread(i + 1, `c${i + 1}`))
      let served = 0
      api.responder = (method) => {
        if (method !== 'get') return { data: {}, status: 200 }
        served += 1
        return served === 1
          ? { data: { items: page1, nextCursor: 25 }, status: 200 }
          : { data: { items: [thread(26, 'c26')], nextCursor: null }, status: 200 }
      }

      const { result } = renderHook(() => useDocComments('d_1'))
      await flush()
      expect(result.current.threads).toHaveLength(25)
      await act(async () => {
        await result.current.loadMore()
      })
      expect(result.current.threads).toHaveLength(26)
      const afterLoadMore = api.calls.length

      await act(async () => {
        vi.advanceTimersByTime(COMMENT_POLL_INTERVAL_MS * 2)
      })
      await flush()
      expect(api.calls.length).toBe(afterLoadMore)
      expect(result.current.threads).toHaveLength(26)
    } finally {
      restore()
    }
  })
})
