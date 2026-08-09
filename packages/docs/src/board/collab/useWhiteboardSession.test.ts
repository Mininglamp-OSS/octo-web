import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { setWKApp } from '../../octoweb/index.ts'
import { createMockWKApp } from '../../octoweb/mock.ts'
import { WS_ENDPOINT } from '../../config.ts'
import { __resetTokenCacheForTests } from '../../auth/collabToken.ts'

// The session assembler builds a real HocuspocusProvider (opens a WebSocket); stub it so the hook's
// registry / refcount / token-wiring is unit-testable without a live collab backend. We capture the
// options the hook passes in and hand back a fake session whose destroy() we can assert on.
const created: { opts: any; destroy: ReturnType<typeof vi.fn>; setLocalState: ReturnType<typeof vi.fn> }[] = []
vi.mock('./connect.ts', () => ({
  createWhiteboardSession: (opts: any) => {
    const destroy = vi.fn()
    const setLocalState = vi.fn()
    const session = {
      documentName: `octo:${opts.space}:${opts.folder}:wb:${opts.board}`,
      provider: { awareness: { setLocalState } },
      destroy,
    }
    created.push({ opts, destroy, setLocalState })
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
    expect(created[0]!.setLocalState).toHaveBeenCalledWith(null)
    // Release destroys through the create promise (identity-first async build), so wait for it.
    await waitFor(() => expect(created[0]!.destroy).toHaveBeenCalledTimes(1)) // last release destroys
  })

  it('does not clear awareness while another reference still owns the shared session', async () => {
    const useWhiteboardSession = await importHook()
    const opts = { uid: 'u_presence', space: 'demo', folder: 'f_default', board: 'd_presence' }
    const a = renderHook(() => useWhiteboardSession(opts))
    const b = renderHook(() => useWhiteboardSession(opts))
    await waitFor(() => expect(a.result.current).not.toBeNull())
    act(() => a.unmount())
    expect(created[0]!.setLocalState).not.toHaveBeenCalled()
    act(() => b.unmount())
    expect(created[0]!.setLocalState).toHaveBeenCalledWith(null)
  })

  it('returns null synchronously on an A → B uid switch before B session resolves', async () => {
    const useWhiteboardSession = await importHook()
    let uid = 'u_a'
    const options = () => ({ uid, space: 'demo', folder: 'f_default', board: 'd_board1' })
    const hook = renderHook(() => useWhiteboardSession(options()))

    await waitFor(() => expect(hook.result.current).not.toBeNull())
    const sessionA = hook.result.current
    expect(created[0]!.opts.uid).toBe('u_a')

    // This rerender is the real key-change first frame. React has not run the old [key] effect's
    // cleanup or acquired B yet, so the state still physically holds A. The hook must nevertheless
    // synchronously return null rather than exposing A under B's identity.
    uid = 'u_b'
    hook.rerender()
    expect(hook.result.current).toBeNull()
    expect(hook.result.current).not.toBe(sessionA)

    await waitFor(() => expect(hook.result.current).not.toBeNull())
    expect(hook.result.current).not.toBe(sessionA)
    expect(created.at(-1)!.opts.uid).toBe('u_b')
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

  it('does not install an in-flight stale session into a newly re-acquired registry entry', async () => {
    const useWhiteboardSession = await importHook()
    const opts = { uid: 'u_race', space: 'demo', folder: 'f_default', board: 'd_race' }
    const tokenResolvers: Array<(value: { data: unknown; status: number }) => void> = []
    wk.apiClient.responder = (method, url) => {
      if (method === 'post' && url === '/docs/collab-token') {
        return new Promise((resolve) => tokenResolvers.push(resolve))
      }
      return { data: {}, status: 200 }
    }

    const first = renderHook(() => useWhiteboardSession(opts))
    await waitFor(() => expect(tokenResolvers).toHaveLength(1))
    act(() => first.unmount())

    const second = renderHook(() => useWhiteboardSession(opts))
    // Token issuance is intentionally coalesced by uid+documentName, so both registry entries await
    // the same token promise while still creating distinct sessions after it resolves.
    expect(tokenResolvers).toHaveLength(1)

    await act(async () => {
      tokenResolvers[0]!({
        data: { token: 'shared', expiresAt: Date.now() + 60_000, role: 'writer', permission_epoch: 1 },
        status: 200,
      })
      await Promise.resolve()
    })
    await waitFor(() => expect(created).toHaveLength(2))
    expect(created[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(created[0]!.setLocalState).toHaveBeenCalledWith(null)
    await waitFor(() => expect(second.result.current).not.toBeNull())
    expect(second.result.current?.destroy).toBe(created[1]!.destroy)
    expect(created[1]!.destroy).not.toHaveBeenCalled()

    act(() => second.unmount())
    await waitFor(() => expect(created[1]!.destroy).toHaveBeenCalledTimes(1))
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
