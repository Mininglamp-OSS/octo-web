import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { ShareScopePanel } from './ShareScopePanel.tsx'

let wk: ReturnType<typeof createMockWKApp>
let api: MockApiClient

beforeEach(() => {
  wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
  // Default: quiet responder so an unrouted GET /share resolves to the restricted/read default.
  api.responder = () => ({ data: {}, status: 200 })
})

afterEach(() => cleanup())

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[]
const roleSelect = () => screen.queryByLabelText('docs.share.permission') as HTMLSelectElement | null
const gets = () => api.calls.filter((c) => c.method === 'get')
const puts = () => api.calls.filter((c) => c.method === 'put')

describe('ShareScopePanel — seed initial state (#64)', () => {
  it('uses a restricted seed without a second GET, and hides the permission select', () => {
    render(<ShareScopePanel docId="d_1" seed={{ shareScope: 'restricted', shareRole: 'read' }} />)
    expect(radios()[0].checked).toBe(true)
    expect(radios()[1].checked).toBe(false)
    expect(roleSelect()).toBeNull()
    expect(gets()).toHaveLength(0)
  })

  it('uses an anyone_in_space/edit seed and shows the permission select at edit', () => {
    render(<ShareScopePanel docId="d_1" seed={{ shareScope: 'anyone_in_space', shareRole: 'edit' }} />)
    expect(radios()[1].checked).toBe(true)
    expect(roleSelect()?.value).toBe('edit')
    expect(gets()).toHaveLength(0)
  })

  it('fetches GET /share on mount when no seed is supplied', async () => {
    api.responder = (method, url) =>
      method === 'get' && url.endsWith('/share')
        ? { data: { shareScope: 'anyone_in_space', shareRole: 'read' }, status: 200 }
        : { data: {}, status: 200 }
    render(<ShareScopePanel docId="d_1" />)
    await waitFor(() => expect(radios()[1].checked).toBe(true))
    expect(roleSelect()?.value).toBe('read')
    expect(api.calls[0]).toMatchObject({ method: 'get', url: '/docs/d_1/share' })
  })

  it('surfaces an unknown/error state (not a confident Restricted) when GET /share fails', async () => {
    api.responder = (method) => {
      if (method === 'get') throw { response: { status: 500 } }
      return { data: {}, status: 200 }
    }
    render(<ShareScopePanel docId="d_1" />)
    // Read failed → the true scope is UNKNOWN. The panel must NOT present a confident "Restricted":
    // no radio is checked and an explicit error is surfaced. Controls stay actionable so the admin
    // can assert a scope rather than being stuck.
    await waitFor(() => expect(screen.getByText('docs.share.loadError')).toBeTruthy())
    expect(radios()[0].checked).toBe(false)
    expect(radios()[1].checked).toBe(false)
    expect(roleSelect()).toBeNull()
  })

  it('lets an admin re-assert Restricted from the unknown/error state (PUT fires)', async () => {
    let putBody: unknown
    api.responder = (method, _url, body) => {
      if (method === 'get') throw { response: { status: 500 } }
      if (method === 'put') {
        putBody = body
        return { data: { shareScope: 'restricted', shareRole: 'read' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<ShareScopePanel docId="d_1" />)
    await waitFor(() => expect(screen.getByText('docs.share.loadError')).toBeTruthy())
    // From the unknown state, explicitly asserting Restricted must fire a PUT (the old
    // `next === scope` early-return blocked re-asserting a stale/unknown "Restricted").
    fireEvent.click(radios()[0])
    await waitFor(() => expect(putBody).toEqual({ shareScope: 'restricted' }))
    await waitFor(() => expect(radios()[0].checked).toBe(true))
  })

  it('retries the GET after a read failure and shows the resolved scope', async () => {
    let fail = true
    api.responder = (method, url) => {
      if (method === 'get' && url.endsWith('/share')) {
        if (fail) throw { response: { status: 500 } }
        return { data: { shareScope: 'anyone_in_space', shareRole: 'edit' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<ShareScopePanel docId="d_1" />)
    await waitFor(() => expect(screen.getByText('docs.share.loadError')).toBeTruthy())
    fail = false
    fireEvent.click(screen.getByText('docs.share.retry'))
    await waitFor(() => expect(radios()[1].checked).toBe(true))
    expect(roleSelect()?.value).toBe('edit')
  })

  it('adopts an async seed that arrives after mount and overrides the in-flight read', async () => {
    // Mount with no seed → the panel starts fetching (GET returns restricted/read). Simulate
    // EditorShell delivering the seed later (getDoc resolves after the panel mounted) by rerendering
    // with a valid seed prop, and assert the authoritative seed drives the UI over the fetched value.
    api.responder = (method, url) =>
      method === 'get' && url.endsWith('/share')
        ? { data: { shareScope: 'restricted', shareRole: 'read' }, status: 200 }
        : { data: {}, status: 200 }
    const { rerender } = render(<ShareScopePanel docId="d_1" />)
    rerender(
      <ShareScopePanel docId="d_1" seed={{ shareScope: 'anyone_in_space', shareRole: 'edit' }} />,
    )
    // The newly-arrived authoritative seed drives the UI to anyone_in_space/edit.
    await waitFor(() => expect(radios()[1].checked).toBe(true))
    expect(roleSelect()?.value).toBe('edit')
    // Only the initial pre-seed mount fetched; adopting the seed triggers no additional read.
    expect(gets()).toHaveLength(1)
  })
})

describe('ShareScopePanel — change-on-select + conditional tier (#64)', () => {
  it('switching to Anyone in Space PUTs anyone_in_space + read and reveals the tier', async () => {
    let putBody: unknown
    api.responder = (method, _url, body) => {
      if (method === 'put') {
        putBody = body
        return { data: { shareScope: 'anyone_in_space', shareRole: 'read' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<ShareScopePanel docId="d_1" seed={{ shareScope: 'restricted', shareRole: 'read' }} />)
    fireEvent.click(radios()[1])
    await waitFor(() =>
      expect(putBody).toEqual({ shareScope: 'anyone_in_space', shareRole: 'read' }),
    )
    await waitFor(() => expect(roleSelect()).not.toBeNull())
    expect(roleSelect()?.value).toBe('read')
  })

  it('switching back to Restricted PUTs restricted (no role) and hides the tier', async () => {
    api.responder = (method) =>
      method === 'put'
        ? { data: { shareScope: 'restricted', shareRole: 'read' }, status: 200 }
        : { data: {}, status: 200 }
    render(<ShareScopePanel docId="d_1" seed={{ shareScope: 'anyone_in_space', shareRole: 'edit' }} />)
    fireEvent.click(radios()[0])
    await waitFor(() => expect(roleSelect()).toBeNull())
    expect(puts()[0].body).toEqual({ shareScope: 'restricted' })
  })

  it('changing the permission tier PUTs anyone_in_space + the chosen role', async () => {
    api.responder = (method, _url, body) =>
      method === 'put'
        ? {
            data: {
              shareScope: 'anyone_in_space',
              shareRole: (body as { shareRole?: string }).shareRole,
            },
            status: 200,
          }
        : { data: {}, status: 200 }
    render(<ShareScopePanel docId="d_1" seed={{ shareScope: 'anyone_in_space', shareRole: 'read' }} />)
    fireEvent.change(roleSelect()!, { target: { value: 'edit' } })
    await waitFor(() => expect(roleSelect()?.value).toBe('edit'))
    expect(puts()[0].body).toEqual({ shareScope: 'anyone_in_space', shareRole: 'edit' })
  })
})

describe('ShareScopePanel — in-flight + rollback (#64)', () => {
  it('disables the controls while the PUT is in flight', async () => {
    let resolvePut: () => void = () => {}
    api.responder = (method) => {
      if (method === 'put') {
        return new Promise((resolve) => {
          resolvePut = () =>
            resolve({ data: { shareScope: 'anyone_in_space', shareRole: 'read' }, status: 200 })
        })
      }
      return { data: {}, status: 200 }
    }
    render(<ShareScopePanel docId="d_1" seed={{ shareScope: 'restricted', shareRole: 'read' }} />)
    fireEvent.click(radios()[1])
    await waitFor(() => expect(radios()[0].disabled).toBe(true))
    resolvePut()
    await waitFor(() => expect(radios()[0].disabled).toBe(false))
  })

  it('rolls back to the prior scope and surfaces an error when the PUT fails', async () => {
    api.responder = (method) => {
      if (method === 'put') throw { response: { status: 400, data: { error: 'invalid_role' } } }
      return { data: {}, status: 200 }
    }
    render(<ShareScopePanel docId="d_1" seed={{ shareScope: 'restricted', shareRole: 'read' }} />)
    fireEvent.click(radios()[1])
    await waitFor(() => expect(screen.getByText('docs.share.error')).toBeTruthy())
    // Rolled back: restricted stays selected and the tier stays hidden.
    expect(radios()[0].checked).toBe(true)
    expect(roleSelect()).toBeNull()
  })
})
