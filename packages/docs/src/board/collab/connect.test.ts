import { describe, it, expect, beforeEach, vi } from 'vitest'
// createWhiteboardSession builds a real HocuspocusProvider (opens a WebSocket) and an
// IndexeddbPersistence (opens IDB). Stub both so the session's runtime-permission wiring (P1-3) and
// the uid-scoped cache name (P1-1) are unit-testable without a live backend / browser.
//
// The fakes live in vi.hoisted so the (hoisted) vi.mock factories below can reference them.
const { FakeProvider, FakeIndexeddbPersistence } = vi.hoisted(() => {
  type Handler = (payload: unknown) => void
  class FakeProvider {
    static last: FakeProvider | null = null
    opts: Record<string, unknown>
    handlers = new Map<string, Handler[]>()
    connect = vi.fn()
    disconnect = vi.fn()
    destroy = vi.fn()
    awareness = {}
    constructor(opts: Record<string, unknown>) {
      this.opts = opts
      FakeProvider.last = this
    }
    on(event: string, cb: Handler): void {
      const list = this.handlers.get(event) ?? []
      list.push(cb)
      this.handlers.set(event, list)
    }
    emit(event: string, payload: unknown): void {
      for (const cb of this.handlers.get(event) ?? []) cb(payload)
    }
  }
  class FakeIndexeddbPersistence {
    static lastName: string | null = null
    destroy = vi.fn()
    constructor(
      public name: string,
      public doc: unknown,
    ) {
      FakeIndexeddbPersistence.lastName = name
    }
    on(): void {}
  }
  return { FakeProvider, FakeIndexeddbPersistence }
})

vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: FakeProvider }))
vi.mock('y-indexeddb', () => ({ IndexeddbPersistence: FakeIndexeddbPersistence }))

import { createWhiteboardSession } from './connect.ts'

const BASE = {
  space: 'demo',
  folder: 'f_default',
  board: 'd_board1',
  uid: 'u_self',
  url: 'wss://collab.example.com',
  token: () => 'wb-jwt',
}
const DOC_NAME = 'octo:demo:f_default:wb:d_board1'

beforeEach(() => {
  FakeProvider.last = null
  FakeIndexeddbPersistence.lastName = null
})

describe('createWhiteboardSession — runtime permission wiring (P1-1 / P1-3)', () => {
  it('scopes the IndexedDB cache name by uid (P1-1)', () => {
    createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1 })
    expect(FakeIndexeddbPersistence.lastName).toBe(`octo-wb:u_self:${DOC_NAME}`)
  })

  it('does not build a local cache when offline cache is disabled', () => {
    FakeIndexeddbPersistence.lastName = null
    const s = createWhiteboardSession({ ...BASE, disableOfflineCache: true })
    expect(FakeIndexeddbPersistence.lastName).toBeNull()
    expect(s.persistence).toBeNull()
  })

  it('connects with connect:false then explicitly connects (listeners armed first)', () => {
    createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1 })
    const p = FakeProvider.last!
    expect(p.opts.url).toBe('wss://collab.example.com')
    expect(p.opts.connect).toBe(false)
    expect(p.connect).toHaveBeenCalledTimes(1)
  })

  it('reports the primed initial role and editability', () => {
    const writer = createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1 })
    expect(writer.getRole()).toBe('writer')
    expect(writer.canEdit()).toBe(true)
  })

  it('fails closed to reader when no initial role is primed (P1-2)', () => {
    const s = createWhiteboardSession({ ...BASE })
    expect(s.getRole()).toBe('reader')
    expect(s.canEdit()).toBe(false)
  })

  it('locks the board (writer → reader) on a stateless role-change downgrade frame (P1-3)', () => {
    const disposeToken = vi.fn()
    const s = createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1, disposeToken })
    const roles: string[] = []
    s.subscribeRole((r) => roles.push(r))

    FakeProvider.last!.emit('stateless', {
      payload: JSON.stringify({ type: 'role-change', role: 'reader', permission_epoch: 2 }),
    })

    expect(s.getRole()).toBe('reader')
    expect(s.canEdit()).toBe(false)
    expect(roles).toEqual(['reader'])
    // Downgrade invalidates the cached token so a reconnect re-issues with the new role/epoch.
    expect(disposeToken).toHaveBeenCalledWith(DOC_NAME)
  })

  it('tears down to a terminal "deleted" state + read-only on a 4403 close (P1-3)', () => {
    const s = createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1 })
    const terminals: string[] = []
    const roles: string[] = []
    s.subscribeTerminal((t) => terminals.push(t.kind))
    s.subscribeRole((r) => roles.push(r))

    FakeProvider.last!.emit('close', { event: { code: 4403 } })

    expect(terminals).toContain('deleted')
    expect(roles).toContain('reader') // rollbackPending downgrades to read-only
    expect(FakeProvider.last!.disconnect).toHaveBeenCalled()
  })

  it('unsubscribe stops further role notifications', () => {
    const s = createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1 })
    const roles: string[] = []
    const off = s.subscribeRole((r) => roles.push(r))
    off()
    FakeProvider.last!.emit('stateless', {
      payload: JSON.stringify({ type: 'role-change', role: 'reader', permission_epoch: 2 }),
    })
    expect(roles).toEqual([])
  })

  it('destroy() tears down provider, persistence and clears listeners', () => {
    const s = createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1 })
    const p = FakeProvider.last!
    s.destroy()
    expect(p.destroy).toHaveBeenCalled()
  })

  it('destroy() disposes the collab token on a normal session end (editor parity)', () => {
    const disposeToken = vi.fn()
    const s = createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1, disposeToken })
    s.destroy()
    // Mirrors createCollabEditor.destroyAll: a normal teardown drops the cached token so it is not
    // left to expire (hygiene/parity — the 4403 revoke path already disposes on its own).
    expect(disposeToken).toHaveBeenCalledWith(DOC_NAME)
  })
})

describe('createWhiteboardSession — ordered cache teardown on revoke (P1-1)', () => {
  it('closes the y-indexeddb handle THEN deletes the DB on a 4403 revoke', async () => {
    const order: string[] = []
    const delSpy = vi
      .spyOn(indexedDB, 'deleteDatabase')
      .mockImplementation(((name: string) => {
        order.push(`delete:${name}`)
        const req: Record<string, unknown> = {}
        // resolve deleteDatabaseAwait cleanly on the next microtask
        queueMicrotask(() => (req.onsuccess as (() => void) | undefined)?.())
        return req as unknown as IDBOpenDBRequest
      }) as typeof indexedDB.deleteDatabase)

    const s = createWhiteboardSession({ ...BASE, initialRole: 'writer', initialEpoch: 1 })
    const persistence = s.persistence as unknown as { destroy: ReturnType<typeof vi.fn> }
    persistence.destroy.mockImplementation(() => {
      order.push('destroy')
      return Promise.resolve()
    })

    // 4403 = access revoked / board deleted under us.
    FakeProvider.last!.emit('close', { event: { code: 4403 } })
    // Teardown is async (await destroy → deleteDatabase); let the microtasks run.
    await new Promise((r) => setTimeout(r, 0))

    // y-indexeddb destroy() only CLOSES the handle; the on-disk DB must be explicitly deleted, and
    // the handle must close first or deleteDatabase blocks.
    expect(persistence.destroy).toHaveBeenCalled()
    expect(delSpy).toHaveBeenCalledWith(`octo-wb:u_self:${DOC_NAME}`)
    expect(order).toEqual(['destroy', `delete:octo-wb:u_self:${DOC_NAME}`])
    delSpy.mockRestore()
  })
})

describe('createWhiteboardSession — auth-denied session is terminal, no cache (P1-3)', () => {
  it('builds no local cache and replays the initial terminal without connecting', () => {
    FakeIndexeddbPersistence.lastName = null
    const s = createWhiteboardSession({ ...BASE, initialTerminal: { kind: 'deleted' } })
    // A backend-denied user must have NO cache to hydrate.
    expect(s.persistence).toBeNull()
    expect(FakeIndexeddbPersistence.lastName).toBeNull()
    // The terminal replays to a late subscriber (BoardShell subscribes after construction).
    const seen: string[] = []
    s.subscribeTerminal((t) => seen.push(t.kind))
    expect(seen).toEqual(['deleted'])
    // A denied session must not open the socket.
    expect(FakeProvider.last!.connect).not.toHaveBeenCalled()
  })
})
