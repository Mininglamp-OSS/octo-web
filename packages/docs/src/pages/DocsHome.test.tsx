import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { resolveDocTarget, clearDocTarget, DocsHome } from './DocsHome.tsx'

// Replace the heavy editor shell (Tiptap + Yjs + Hocuspocus) with a marker so the DocsHome
// render tests exercise target-resolution / navigation without mounting the real editor.
// The marker surfaces the docId it was addressed with and the onBack affordance.
vi.mock('../editor/EditorShell.tsx', () => ({
  EditorShell: (props: {
    docId: string
    onBack?: () => void
    headerRight?: React.ReactNode
    onOpenInNewPage?: () => void
  }) => (
    <div data-testid="editor-shell">
      <span data-testid="editor-doc">{props.docId}</span>
      <div data-testid="editor-header-right">{props.headerRight}</div>
      {props.onOpenInNewPage && (
        <button type="button" data-testid="editor-open-new-page" onClick={props.onOpenInNewPage}>
          docs.standalone.openInNewPage
        </button>
      )}
      {props.onBack && (
        <button type="button" data-testid="editor-back" onClick={props.onBack}>
          back
        </button>
      )}
    </div>
  ),
}))

const TARGET_KEY = 'octo.docs.target'

let assignSpy: ReturnType<typeof vi.fn>
let replaceStateSpy: ReturnType<typeof vi.fn>
const realLocation = window.location

beforeEach(() => {
  window.sessionStorage.clear()
  // jsdom's window.location.assign is non-configurable and throws "Not implemented" on call.
  // Swap in a minimal stub exposing only what DocsHome touches (search + assign) so the
  // open / back navigations are observable without a real page load.
  assignSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { search: '', assign: assignSpy },
  })
  // Split-pane mirrors selection to the URL via history.replaceState (no host re-push),
  // not a full navigation — stub it so the URL-mirror is observable.
  replaceStateSpy = vi.fn()
  // Cast at the call site: vitest 4's loosely-typed `vi.fn()` isn't directly assignable to the
  // precise `replaceState` signature mockImplementation expects (the spy still records calls).
  vi.spyOn(window.history, 'replaceState').mockImplementation(
    replaceStateSpy as unknown as typeof window.history.replaceState,
  )
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: realLocation,
  })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  window.sessionStorage.clear()
})

// resolveDocTarget addresses the doc with a three-tier fallback so the editor stays reachable
// even after the octo host's RouteManager re-pushes pathname-only and strips `?doc=`:
//   1. URL query (deep-link) — also mirrored to sessionStorage so it survives the wipe.
//   2. the persisted sessionStorage target (in-app open / post-wipe re-render).
//   3. the deployment-configured default doc (empty by default → list view).
describe('resolveDocTarget', () => {
  it('returns null when no doc is addressed and nothing is persisted', () => {
    // null target -> DocsHome renders the document list (GET /api/v1/docs) instead of
    // mounting an editor against a non-existent doc.
    expect(resolveDocTarget('')).toBeNull()
    expect(resolveDocTarget('?space=s1&folder=f1')).toBeNull()
  })

  it('reads space/folder/doc from the query string', () => {
    const t = resolveDocTarget('?space=sp1&folder=fd1&doc=d_real123')
    expect(t).toEqual({ space: 'sp1', folder: 'fd1', doc: 'd_real123', docId: 'd_real123' })
  })

  it('accepts docId as an alias for doc', () => {
    const t = resolveDocTarget('?docId=d_alias')
    expect(t).not.toBeNull()
    expect(t!.doc).toBe('d_alias')
    expect(t!.docId).toBe('d_alias')
  })

  it('falls back to default space/folder when only doc is provided', () => {
    const t = resolveDocTarget('?doc=d_only')
    expect(t).not.toBeNull()
    // defaults from config.ts: space='demo', folder='f_default'
    expect(t!.space).toBe('demo')
    expect(t!.folder).toBe('f_default')
    expect(t!.doc).toBe('d_only')
  })

  it('does not hardcode the non-existent d_welcome demo doc', () => {
    // Regression (2026-06-18): the editor hung on "Loading document…" because DocsHome
    // hardcoded doc='d_welcome', which exists in no DB. The default doc must be empty
    // (env-configurable) so an un-addressed /docs lists real documents instead.
    expect(resolveDocTarget('')).toBeNull()
  })

  it('persists the query doc so it survives the host wiping the query (second blocker)', () => {
    // Deep-link resolves from the query AND mirrors itself to sessionStorage. The host then
    // re-pushes pathname-only (`pageshow`/`popstate`) and the next render sees an empty query —
    // resolveDocTarget must still return the same doc from the mirror, not fall back to the list.
    const first = resolveDocTarget('?space=sp1&folder=fd1&doc=d_keep')
    expect(first!.doc).toBe('d_keep')
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      space: 'sp1',
      folder: 'fd1',
      doc: 'd_keep',
    })
    // Query wiped -> still resolves the persisted target.
    const afterWipe = resolveDocTarget('?sid=yjru4i')
    expect(afterWipe).toEqual({ space: 'sp1', folder: 'fd1', doc: 'd_keep', docId: 'd_keep' })
  })

  it('falls back to a persisted target when the query carries no doc', () => {
    window.sessionStorage.setItem(
      TARGET_KEY,
      JSON.stringify({ space: 'spX', folder: 'fdX', doc: 'd_stored' }),
    )
    const t = resolveDocTarget('?sid=abc')
    expect(t).toEqual({ space: 'spX', folder: 'fdX', doc: 'd_stored', docId: 'd_stored' })
  })

  it('prefers the query doc over a stale persisted target', () => {
    window.sessionStorage.setItem(TARGET_KEY, JSON.stringify({ doc: 'd_stale' }))
    const t = resolveDocTarget('?doc=d_fresh')
    expect(t!.doc).toBe('d_fresh')
  })

  it('ignores a malformed persisted target', () => {
    window.sessionStorage.setItem(TARGET_KEY, 'not-json')
    expect(resolveDocTarget('?sid=abc')).toBeNull()
    window.sessionStorage.setItem(TARGET_KEY, JSON.stringify({ space: 'x' })) // no doc
    expect(resolveDocTarget('?sid=abc')).toBeNull()
  })
})

describe('clearDocTarget', () => {
  it('removes the persisted target so the next resolve returns null', () => {
    resolveDocTarget('?doc=d_open') // persists
    expect(window.sessionStorage.getItem(TARGET_KEY)).not.toBeNull()
    clearDocTarget()
    expect(window.sessionStorage.getItem(TARGET_KEY)).toBeNull()
    expect(resolveDocTarget('?sid=abc')).toBeNull()
  })
})

describe('DocsHome navigation (split-pane)', () => {
  it('opens a newly created document inline in the right pane (list stays resident)', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      if (method === 'post' && url === '/docs') {
        return {
          data: {
            docId: 'd_new',
            documentName: 'doc:d_new',
            title: '',
            spaceId: 'demo',
            folderId: 'f_default',
            ownerId: 'u_self',
            role: 'admin',
          },
          status: 201,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // No doc addressed and nothing persisted -> the list renders (left pane).
    await waitFor(() => expect(screen.getByText('docs.state.empty')).toBeTruthy())

    fireEvent.click(screen.getByText('docs.list.new'))

    // Split-pane: the editor mounts INLINE in the right pane (no full navigation),
    // and the list stays resident on the left.
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_new')
    // selection mirrored to sessionStorage + URL (replaceState, not assign).
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({ doc: 'd_new' })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(replaceStateSpy).toHaveBeenCalled()
    expect(String(replaceStateSpy.mock.calls.at(-1)![2])).toContain('doc=d_new')
  })

  it('opens an existing document inline in the right pane and marks it active', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return {
          data: {
            total: 1,
            items: [{ docId: 'd_a', title: 'Doc A', ownerId: 'u_self', role: 'admin' }],
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('Doc A')).toBeTruthy())

    fireEvent.click(screen.getByText('Doc A'))

    // Editor mounts inline; list (Doc A) stays resident.
    expect(screen.getByTestId('editor-shell')).toBeTruthy()
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_a')
    expect(screen.getByText('Doc A')).toBeTruthy()
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({ doc: 'd_a' })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(String(replaceStateSpy.mock.calls.at(-1)![2])).toContain('doc=d_a')
  })

  it('AC-1: the open doc exposes an "Open in new page" entry that opens the /d/:docId standalone link', async () => {
    const openSpy = vi.fn()
    Object.defineProperty(window, 'open', { configurable: true, writable: true, value: openSpy })
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return {
          data: {
            total: 1,
            items: [{ docId: 'd_a', title: 'Doc A', ownerId: 'u_self', role: 'admin' }],
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('Doc A')).toBeTruthy())
    fireEvent.click(screen.getByText('Doc A'))

    // The entry is wired into the editor via onOpenInNewPage (it now lives in the header ≡ menu,
    // no longer a resident headerRight button).
    const entry = screen.getByTestId('editor-open-new-page')
    fireEvent.click(entry)

    // It opens the clean standalone deep-link in a new tab — no in-app navigation.
    expect(openSpy).toHaveBeenCalledWith('/d/d_a', '_blank', 'noopener,noreferrer')
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('AC-1 (XIN-420): a multi-session user opens the standalone link carrying the current session sid', async () => {
    const openSpy = vi.fn()
    Object.defineProperty(window, 'open', { configurable: true, writable: true, value: openSpy })
    // Multi-session in-shell URL: the host's RouteManager re-push collapses the docs route to
    // `/docs?sid=…`, so the active session's sid rides on window.location. Give the stub a real
    // origin too — withReturnSid rebuilds the target against it.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://app.example.com', search: '?sid=s_active', assign: assignSpy },
    })
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return {
          data: {
            total: 1,
            items: [{ docId: 'd_a', title: 'Doc A', ownerId: 'u_self', role: 'admin' }],
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('Doc A')).toBeTruthy())
    fireEvent.click(screen.getByText('Doc A'))
    fireEvent.click(screen.getByTestId('editor-open-new-page'))

    // The new tab must carry the active sid so its sid-keyed load() hits the right bucket. Without
    // it a multi-session user's new tab reads the empty-sid bucket, misses, and (since XIN-392's
    // strict findUniqueStoredSession refuses to guess) bounces to login instead of the document.
    expect(openSpy).toHaveBeenCalledWith('/d/d_a?sid=s_active', '_blank', 'noopener,noreferrer')
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('mounts the editor inline from a persisted target on first paint (deep-link / refresh)', async () => {
    window.sessionStorage.setItem(
      TARGET_KEY,
      JSON.stringify({ space: 'sp', folder: 'fd', doc: 'd_persist' }),
    )
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    expect(screen.getByTestId('editor-shell')).toBeTruthy()
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_persist')
  })

  it('back-to-list unmounts the editor and clears the persisted target (no full navigation)', async () => {
    window.sessionStorage.setItem(TARGET_KEY, JSON.stringify({ doc: 'd_persist' }))
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    fireEvent.click(screen.getByTestId('editor-back'))

    // Editor unmounts (right pane empty), persisted target cleared, no full navigation.
    await waitFor(() => expect(screen.queryByTestId('editor-shell')).toBeNull())
    expect(window.sessionStorage.getItem(TARGET_KEY)).toBeNull()
    expect(assignSpy).not.toHaveBeenCalled()
    expect(String(replaceStateSpy.mock.calls.at(-1)![2])).not.toContain('doc=')
  })
})

describe('DocsHome — reloads the list when the current Space switches', () => {
  // Regression (XIN-410): switching Space did NOT refresh the document list. `space` was derived
  // directly from the mutable `WKApp.shared.currentSpaceId`, which is not React state — reassigning
  // it on a switch never re-rendered DocsHome, so the list kept showing the old Space's docs until a
  // manual reload. DocsHome now subscribes to the host `space-changed` bus and re-reads the id.
  const listGets = (wk: ReturnType<typeof createMockWKApp>) =>
    wk.apiClient.calls.filter((c) => c.method === 'get' && c.url.startsWith('/docs?'))

  it('re-fetches the list for the new Space when space-changed fires', async () => {
    const wk = createMockWKApp()
    wk.shared.currentSpaceId = 'space-a'
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // Initial load queries the first Space.
    await waitFor(() => expect(listGets(wk).length).toBe(1))
    expect(listGets(wk)[0].url).toContain('spaceId=space-a')

    // The host switches Space: it mutates currentSpaceId then broadcasts space-changed.
    wk.shared.currentSpaceId = 'space-b'
    wk.mockMittBus.emitSpaceChanged({ space_id: 'space-b' })

    // The list re-fetches — now scoped to the new Space.
    await waitFor(() => expect(listGets(wk).length).toBe(2))
    expect(listGets(wk).at(-1)!.url).toContain('spaceId=space-b')
  })

  it('re-fetches exactly once per switch (no duplicate-request storm)', async () => {
    const wk = createMockWKApp()
    wk.shared.currentSpaceId = 'space-a'
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(listGets(wk).length).toBe(1))

    wk.shared.currentSpaceId = 'space-b'
    wk.mockMittBus.emitSpaceChanged({ space_id: 'space-b' })
    await waitFor(() => expect(listGets(wk).length).toBe(2))

    // A redundant broadcast for the SAME space must not trigger another fetch.
    wk.mockMittBus.emitSpaceChanged({ space_id: 'space-b' })
    await new Promise((r) => setTimeout(r, 20))
    expect(listGets(wk).length).toBe(2)
  })

  it('unsubscribes from the bus on unmount (no leaked listener)', async () => {
    const wk = createMockWKApp()
    wk.shared.currentSpaceId = 'space-a'
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { unmount } = render(<DocsHome />)
    await waitFor(() => expect(wk.mockMittBus.spaceChangedListenerCount()).toBe(1))
    unmount()
    expect(wk.mockMittBus.spaceChangedListenerCount()).toBe(0)
  })
})

describe('DocsHome — a Space switch reconciles the open selection back to the list (P0)', () => {
  // Regression (XIN-448): switching Space bumped `space` but left `selectedDocId`, the persisted
  // `octo.docs.target`, and the URL pointing at the doc opened under the PREVIOUS Space. That
  // rebuilt EditorShell with the OLD docId under the NEW space — a cross-Space collab session
  // (octo:<newSpace>:<folder>:<oldDoc>), a data-isolation leak — and a refresh restored the old
  // Space's doc from the persisted target. A switch must reconcile the selection back to the
  // list of the new Space (same primitive as the explicit "back to list").
  it('clears selectedDocId, the persisted target, and the URL doc addressing when the Space switches', async () => {
    // A doc is open under the first Space (persisted target mounts it inline on first paint).
    window.sessionStorage.setItem(
      TARGET_KEY,
      JSON.stringify({ space: 'space-a', folder: 'f_default', doc: 'd_open' }),
    )
    const wk = createMockWKApp()
    wk.shared.currentSpaceId = 'space-a'
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // The editor for the doc opened under space-a is mounted.
    expect(screen.getByTestId('editor-shell')).toBeTruthy()
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_open')

    // Host switches Space: mutate currentSpaceId then broadcast.
    wk.shared.currentSpaceId = 'space-b'
    wk.mockMittBus.emitSpaceChanged({ space_id: 'space-b' })

    // The old doc must NOT stay mounted under the new Space — selection is reset to the list.
    await waitFor(() => expect(screen.queryByTestId('editor-shell')).toBeNull())
    // The persisted target is cleared so a refresh does not restore the previous Space's doc.
    expect(window.sessionStorage.getItem(TARGET_KEY)).toBeNull()
    // The URL is mirrored back to the list (doc addressing dropped), never a full navigation.
    expect(assignSpy).not.toHaveBeenCalled()
    expect(String(replaceStateSpy.mock.calls.at(-1)![2])).not.toContain('doc=')
  })

  it('does not reconcile (nor refetch) on a redundant same-Space broadcast while a doc is open', async () => {
    window.sessionStorage.setItem(
      TARGET_KEY,
      JSON.stringify({ space: 'space-a', folder: 'f_default', doc: 'd_open' }),
    )
    const wk = createMockWKApp()
    wk.shared.currentSpaceId = 'space-a'
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    expect(screen.getByTestId('editor-shell')).toBeTruthy()

    // A redundant broadcast for the SAME Space must not yank the open doc back to the list.
    wk.mockMittBus.emitSpaceChanged({ space_id: 'space-a' })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('editor-shell')).toBeTruthy()
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_open')
    expect(window.sessionStorage.getItem(TARGET_KEY)).not.toBeNull()
  })
})

describe('DocsHome — a stale (out-of-order) list response cannot overwrite the current Space (P0, XIN-417)', () => {
  // Regression (XIN-417): switching Space fires a fresh listDocs, but the previous Space's request
  // may still be in flight. Responses settle in network order, not call order, so an OLDER Space's
  // response can land AFTER the newer one; the unconditional setItems then rendered the old Space's
  // documents into the new Space's page — the very class of bug this PR fixes. A monotonic
  // request-sequence guard must drop any response that a newer reload has superseded.
  it('drops the late old-Space response and keeps the new Space documents rendered', async () => {
    const wk = createMockWKApp()
    wk.shared.currentSpaceId = 'space-a'
    setWKApp(wk)

    // Deferred resolvers keyed by the Space each GET was scoped to, so the test drives the ORDER
    // responses settle independently of the order the requests were issued (delayed / reordered).
    const deferred: Record<string, (items: unknown[]) => void> = {}
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        const spaceId = new URLSearchParams(url.split('?')[1] ?? '').get('spaceId') ?? ''
        return new Promise((resolve) => {
          deferred[spaceId] = (items) =>
            resolve({ data: { total: items.length, items }, status: 200 })
        })
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // Initial load for the first Space is in flight (its resolver is registered but not settled).
    await waitFor(() => expect(deferred['space-a']).toBeTruthy())

    // Host switches Space BEFORE the first request resolves → a second GET starts for space-b.
    wk.shared.currentSpaceId = 'space-b'
    wk.mockMittBus.emitSpaceChanged({ space_id: 'space-b' })
    await waitFor(() => expect(deferred['space-b']).toBeTruthy())

    // Settle the NEWER (space-b) request first so its documents render...
    deferred['space-b']([{ docId: 'd_b', title: 'Space B Doc', ownerId: 'u_self', role: 'admin' }])
    await waitFor(() => expect(screen.getByText('Space B Doc')).toBeTruthy())

    // ...then let the OLDER (space-a) request resolve LAST (out of order). Without the guard this
    // stale setItems would clobber the list with the old Space's doc.
    deferred['space-a']([{ docId: 'd_a', title: 'Space A Doc', ownerId: 'u_self', role: 'admin' }])
    // Give the stale promise a chance to (wrongly) apply before asserting.
    await new Promise((r) => setTimeout(r, 20))

    // The current Space's documents survive; the stale old-Space doc never appears.
    expect(screen.getByText('Space B Doc')).toBeTruthy()
    expect(screen.queryByText('Space A Doc')).toBeNull()
  })
})

describe('DocsHome — production (routeRight) editor has no header back button (#2)', () => {
  it('pushes the editor without onBack but with onExit (return-on-delete)', async () => {
    window.sessionStorage.setItem(TARGET_KEY, JSON.stringify({ doc: 'd_persist' }))
    const wk = createMockWKApp()
    const replaceToRoot = vi.fn()
    // Give the mock a right-pane manager so DocsHome takes the production (resident-list) path.
    ;(wk as { routeRight?: unknown }).routeRight = { replaceToRoot, popToRoot: vi.fn() }
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // Mount effect pushes the editor element for the persisted doc into the right pane.
    await waitFor(() => expect(replaceToRoot).toHaveBeenCalled())
    const pushed = replaceToRoot.mock.calls.at(-1)![0] as {
      props: { docId: string; onBack?: unknown; onExit?: unknown }
    }
    expect(pushed.props.docId).toBe('d_persist')
    expect(pushed.props.onBack).toBeUndefined()
    expect(typeof pushed.props.onExit).toBe('function')
  })
})
