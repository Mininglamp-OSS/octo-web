import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { setWKApp } from '../../octoweb/index.ts'
import { createMockWKApp } from '../../octoweb/mock.ts'
import { WS_ENDPOINT } from '../../config.ts'
import { __resetTokenCacheForTests } from '../../auth/collabToken.ts'

// The session assembler builds a real HocuspocusProvider (opens a WebSocket); stub it so the hook's
// registry / refcount / token-wiring is unit-testable without a live collab backend. We capture the
// options the hook passes in and hand back a fake session whose destroy() we can assert on.
const created: { opts: any; destroy: ReturnType<typeof vi.fn> }[] = []
vi.mock('./connect.ts', () => ({
  createWhiteboardSession: (opts: any) => {
    const destroy = vi.fn()
    const session = { documentName: `octo:${opts.space}:${opts.folder}:wb:${opts.board}`, destroy }
    created.push({ opts, destroy })
    return session
  },
}))

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  created.length = 0
  wk = createMockWKApp()
  setWKApp(wk)
  __resetTokenCacheForTests()
})

afterEach(() => vi.restoreAllMocks())

async function importHook() {
  return (await import('./useWhiteboardSession.ts')).useWhiteboardSession
}

describe('useWhiteboardSession — board collab wiring (XIN-55)', () => {
  it('opens a session sourced from WS_ENDPOINT and returns it', async () => {
    const useWhiteboardSession = await importHook()
    const { result } = renderHook(() =>
      useWhiteboardSession({ uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }),
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(created).toHaveLength(1)
    expect(created[0]!.opts.url).toBe(WS_ENDPOINT)
    expect(created[0]!.opts.space).toBe('demo')
    expect(created[0]!.opts.board).toBe('d_board1')
  })

  it('reuses one session across two mounts of the same board (refcount), destroys on last release', async () => {
    const useWhiteboardSession = await importHook()
    const opts = { uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }
    const a = renderHook(() => useWhiteboardSession(opts))
    const b = renderHook(() => useWhiteboardSession(opts))
    await waitFor(() => expect(a.result.current).not.toBeNull())
    // Same key → exactly one underlying session built and shared.
    expect(created).toHaveLength(1)
    expect(a.result.current).toBe(b.result.current)

    act(() => a.unmount())
    expect(created[0]!.destroy).not.toHaveBeenCalled() // b still holds it
    act(() => b.unmount())
    // Release destroys through the create promise (identity-first async build), so wait for it.
    await waitFor(() => expect(created[0]!.destroy).toHaveBeenCalledTimes(1)) // last release destroys
  })

  it('builds a distinct session per board id', async () => {
    const useWhiteboardSession = await importHook()
    renderHook(() => useWhiteboardSession({ uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }))
    renderHook(() => useWhiteboardSession({ uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board2' }))
    await waitFor(() => expect(created).toHaveLength(2))
    expect(created[0]!.opts.board).toBe('d_board1')
    expect(created[1]!.opts.board).toBe('d_board2')
  })

  it('token getter exchanges the whiteboard documentName via POST /docs/collab-token', async () => {
    const useWhiteboardSession = await importHook()
    let seen: { url: string; body: any } | null = null
    wk.apiClient.responder = (method, url, body) => {
      if (method === 'post' && url === '/docs/collab-token') {
        seen = { url, body }
        return { data: { token: 'wb-jwt', expiresAt: Date.now() + 60_000, role: 'writer', permission_epoch: 1 }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    const { result } = renderHook(() =>
      useWhiteboardSession({ uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }),
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    const token = await created[0]!.opts.token()
    expect(token).toBe('wb-jwt')
    expect(seen).not.toBeNull()
    expect(seen!.body).toEqual({ documentName: 'octo:demo:f_default:wb:d_board1' })
  })

  it('sources the WS origin + initial role/epoch from the primed collab-token (P1-3 / P1-4)', async () => {
    const useWhiteboardSession = await importHook()
    wk.apiClient.responder = (method, url) => {
      if (method === 'post' && url === '/docs/collab-token') {
        return {
          data: {
            token: 'wb-jwt',
            expiresAt: Date.now() + 60_000,
            role: 'writer',
            permission_epoch: 3,
            collabWsUrl: 'wss://collab.prod.example.com',
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }
    const { result } = renderHook(() =>
      useWhiteboardSession({ uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }),
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    // The board honours the backend-issued collabWsUrl instead of the origin-derived default.
    expect(created[0]!.opts.url).toBe('wss://collab.prod.example.com')
    expect(created[0]!.opts.initialRole).toBe('writer')
    expect(created[0]!.opts.initialEpoch).toBe(3)
  })

  it('falls back to WS_ENDPOINT with no pre-connect role when the token prime fails', async () => {
    const useWhiteboardSession = await importHook()
    wk.apiClient.responder = (method, url) => {
      if (method === 'post' && url === '/docs/collab-token') {
        // Invalid role → getCollabTokenEntry throws → prime fails → origin-derived fallback.
        return { data: { token: 't', expiresAt: Date.now() + 60_000, role: 'nope', permission_epoch: 0 }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    const { result } = renderHook(() =>
      useWhiteboardSession({ uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }),
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(created[0]!.opts.url).toBe(WS_ENDPOINT)
    expect(created[0]!.opts.initialRole).toBeUndefined()
    // A transport/compat failure is NOT an auth denial: the session still hydrates (no terminal).
    expect(created[0]!.opts.initialTerminal).toBeUndefined()
    expect(created[0]!.opts.disableOfflineCache).toBeUndefined()
  })

  it('P1-3: a 403 prime builds a terminal, cache-disabled session — no hydration for a denied user', async () => {
    const useWhiteboardSession = await importHook()
    wk.apiClient.responder = (method, url) => {
      if (method === 'post' && url === '/docs/collab-token') {
        // Backend DENIES (revoked / forbidden). getCollabTokenEntry rejects with an HTTP 403.
        throw Object.assign(new Error('forbidden'), { response: { status: 403 } })
      }
      return { data: {}, status: 200 }
    }
    const { result } = renderHook(() =>
      useWhiteboardSession({ uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }),
    )
    await waitFor(() => expect(result.current).not.toBeNull())
    // Terminal from birth (403 = access revoked → 'deleted'), and NO cache built to hydrate.
    expect(created[0]!.opts.initialTerminal).toEqual({ kind: 'deleted' })
    expect(created[0]!.opts.disableOfflineCache).toBe(true)
  })

  it('P1b: a re-acquire that lands after the synchronous release still destroys the OLD session (no leaked provider/IndexedDB handle)', async () => {
    const useWhiteboardSession = await importHook()
    const opts = { uid: 'u_self', space: 'demo', folder: 'f_default', board: 'd_board1' }

    // First mount builds session #0 and resolves it into the registry.
    const a = renderHook(() => useWhiteboardSession(opts))
    await waitFor(() => expect(a.result.current).not.toBeNull())
    expect(created).toHaveLength(1)

    // Rapid unmount + re-mount under the SAME key (StrictMode double-invoke / fast remount). The
    // unmount's release synchronously deletes the registry key and schedules session #0's destroy
    // through its already-resolved promise; the re-mount re-acquires and installs a FRESH entry.
    // Pre-fix, session #0's destroy check saw `registry.has(key)` true (the new entry) and SKIPPED
    // destroy — leaking #0's HocuspocusProvider socket + IndexeddbPersistence handle on the same
    // dbName, which later blocks the revoke-time deleteDatabase. The identity guard destroys #0.
    act(() => a.unmount())
    const b = renderHook(() => useWhiteboardSession(opts))
    await waitFor(() => expect(b.result.current).not.toBeNull())

    // Session #0 (the released one) must be torn down; the newly-acquired session must stay live.
    await waitFor(() => expect(created[0]!.destroy).toHaveBeenCalledTimes(1))
    const live = created[created.length - 1]!
    expect(live.destroy).not.toHaveBeenCalled()

    act(() => b.unmount())
    await waitFor(() => expect(live.destroy).toHaveBeenCalledTimes(1))
  })
})
