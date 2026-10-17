import { afterEach, expect, it, vi } from 'vitest'
import creation from './fixtures/workspaceCreated.im-test.json'

// Captured business-request metadata, not a reconstructed SpaceService URL.
// This is a hermetic wrapper regression replay, not a new live-browser test.


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('emits workspace_created once per successful same-origin creation, not failures, lists or cross-origin', async () => {
    localStorage.clear()
    const send = vi.fn(async (url: string) => {
        if (String(url).includes('/v1/e/b')) return { ok: true, status: 202 } as Response
        if (String(url).includes('network-failure')) throw new TypeError('network down')
        const status = String(url).includes('denied') ? 403 : 200
        return { ok: status === 200, status } as Response
    })
    vi.stubGlobal('fetch', send)
    const { Dap } = await import('../Dap')
    Dap.shared.setEnabled(true)
    Dap.shared.init()
    const path = creation.pathname
    await fetch(`${location.origin}${path}`, { method: creation.method })
    await fetch(`${location.origin}/fleet/api/v1/workspaces`, { method: 'POST' })
    await fetch(`${location.origin}${path}`, { method: 'GET' })
    await fetch(`${location.origin}${path}?case=denied`, { method: 'POST' })
    await fetch(`${location.origin}${path}?case=network-failure`, { method: 'POST' }).catch(() => {})
    // SpaceService creates a tenant Space, not a Loop Workspace.
    await fetch(`${location.origin}/api/v1/space/create`, { method: 'POST' })
    await fetch(`https://external.invalid${path}`, { method: 'POST' })
    Dap.shared.flush()
    await Promise.resolve()
    const events = send.mock.calls.filter(([url]) => String(url).includes('/v1/e/b'))
        .flatMap((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).events)
        .filter((event) => event.event_name === 'workspace_created')
    expect(events).toHaveLength(2)
    for (const event of events) {
        expect(event.props).toBeUndefined()
        expect(JSON.stringify(event)).not.toContain('dap-selftest')
        expect(JSON.stringify(event)).not.toContain('minglue_default')
    }
    Dap.shared.setEnabled(false)
})
