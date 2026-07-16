import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { resolveDocTarget, clearDocTarget, readDocFromHistory, DocsHome } from './DocsHome.tsx'
import { captureDocTargetDeepLink } from '../config.ts'

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

// Replace the whiteboard shell (which lazy-loads the heavy Excalidraw chunk + a canvas) with a
// marker so the board-create / board-open flows are testable in jsdom without Excalidraw.
vi.mock('../board/BoardShell.tsx', () => ({
  BoardShell: (props: { docId: string }) => (
    <div data-testid="board-shell">
      <span data-testid="board-doc">{props.docId}</span>
    </div>
  ),
}))

// Replace the collaborative spreadsheet shell (Univer + Yjs) with a marker so the sheet-open
// flows are testable in jsdom without mounting the heavy Univer runtime. The marker surfaces the
// docId it was addressed with, exactly like the editor / board markers above.
vi.mock('../sheet/SheetView.tsx', () => ({
  SheetView: (props: { docId: string }) => (
    <div data-testid="sheet-view">
      <span data-testid="sheet-doc">{props.docId}</span>
    </div>
  ),
}))

const TARGET_KEY = 'octo.docs.target'

let assignSpy: ReturnType<typeof vi.fn>
let replaceStateSpy: ReturnType<typeof vi.fn>
let pushStateSpy: ReturnType<typeof vi.fn>
const realLocation = window.location

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  // jsdom's window.location.assign is non-configurable and throws "Not implemented" on call.
  // Swap in a minimal stub exposing only what DocsHome touches (search + assign) so the
  // open / back navigations are observable without a real page load.
  assignSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { search: '', assign: assignSpy },
  })
  // Split-pane mirrors selection to the URL via the History API (no host re-push), not a full
  // navigation — stub replaceState AND pushState so the URL-mirror is observable. Opening a doc
  // now normalises the current entry to the list (replaceState) then pushes the doc as its own
  // entry (pushState) so a browser Back returns to the list, not about:blank (XIN-1172).
  replaceStateSpy = vi.fn()
  pushStateSpy = vi.fn()
  // Cast at the call site: vitest 4's loosely-typed `vi.fn()` isn't directly assignable to the
  // precise replaceState/pushState signatures mockImplementation expects (the spies still record).
  vi.spyOn(window.history, 'replaceState').mockImplementation(
    replaceStateSpy as unknown as typeof window.history.replaceState,
  )
  vi.spyOn(window.history, 'pushState').mockImplementation(
    pushStateSpy as unknown as typeof window.history.pushState,
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

  it('captures a forwarded /docs?doc= link at boot so a first-time recipient opens the doc, not the empty list (XIN-328)', () => {
    // End-to-end regression for the forward defect: unlike the "second blocker" test above,
    // the RECIPIENT has never opened this doc, so nothing is pre-persisted. The code-split
    // DocsHome only mounts AFTER the host's pageshow re-push has already collapsed the URL to
    // `/docs?sid=…`, so resolveDocTarget at mount time sees no `?doc=` and — without the boot
    // capture — would return null → empty document list (the reported symptom).
    //
    // captureDocTargetDeepLink() runs at DocsModule.init() (app boot, BEFORE the re-push) and
    // reads the live `?doc=` off the forwarded link, stashing it. resolveDocTarget then resolves
    // the doc from that mirror even though the query is already wiped.
    window.location.search = '?space=sp9&folder=fd9&doc=d_forwarded'
    captureDocTargetDeepLink()
    // Host RouteManager re-pushes pathname-only → URL collapses to /docs?sid=… (no doc).
    window.location.search = '?sid=abc123'
    const opened = resolveDocTarget(window.location.search)
    expect(opened).toEqual({
      space: 'sp9',
      folder: 'fd9',
      doc: 'd_forwarded',
      docId: 'd_forwarded',
    })
  })

  it('capture is a no-op for a plain /docs open (no doc query) so no stale doc is reopened (XIN-328)', () => {
    window.location.search = '?sid=abc123'
    captureDocTargetDeepLink()
    expect(window.sessionStorage.getItem(TARGET_KEY)).toBeNull()
    expect(resolveDocTarget(window.location.search)).toBeNull()
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
    // selection mirrored to sessionStorage + URL. Opening from the list PUSHES a doc entry over a
    // normalised list entry (XIN-1172): the doc addressing lands on pushState, the last replaceState
    // is the list entry beneath it (no `doc=`), so a browser Back returns to the list.
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({ doc: 'd_new' })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(pushStateSpy).toHaveBeenCalled()
    expect(String(pushStateSpy.mock.calls.at(-1)![2])).toContain('doc=d_new')
    expect(String(replaceStateSpy.mock.calls.at(-1)![2])).not.toContain('doc=')
  })

  it('creates a board via the New dropdown and opens it in the board shell', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    const calls: Array<{ method: string; url: string; body?: unknown }> = []
    wk.apiClient.responder = (method, url, body) => {
      calls.push({ method, url, body })
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      if (method === 'post' && url === '/docs') {
        return {
          data: {
            docId: 'b_new',
            documentName: 'doc:b_new',
            title: '',
            spaceId: 'demo',
            folderId: 'f_default',
            ownerId: 'u_self',
            role: 'admin',
            docType: 'board',
          },
          status: 201,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('docs.state.empty')).toBeTruthy())

    // Open the split "New" dropdown and choose "New board".
    fireEvent.click(screen.getByLabelText('docs.list.newMenu'))
    fireEvent.click(screen.getByText('docs.list.newBoard'))

    // The board (not the rich-text editor) opens inline.
    await waitFor(() => expect(screen.getByTestId('board-shell')).toBeTruthy())
    expect(screen.getByTestId('board-doc').textContent).toBe('b_new')
    expect(screen.queryByTestId('editor-shell')).toBeNull()

    // createDoc was sent with the board kind through the docType seam.
    const create = calls.find((c) => c.method === 'post' && c.url === '/docs')
    expect((create?.body as { docType?: string })?.docType).toBe('board')

    // A new board defaults to the board-specific title, not the document fallback.
    expect((create?.body as { title?: string })?.title).toBe('docs.board.untitled')

    // Selection persisted with its kind so a refresh re-opens the board shell.
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      doc: 'b_new',
      docType: 'board',
    })
  })

  it('opens an existing document inline in the right pane and marks it active', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      // List rows from a backend that doesn't echo docType (the common legacy case). The
      // per-doc GET (/docs/d_a) resolves the authoritative kind — here a plain document.
      if (method === 'get' && url === '/docs/d_a') {
        return { data: { docId: 'd_a', title: 'Doc A', role: 'admin', docType: 'doc' }, status: 200 }
      }
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

    // Unknown kind -> resolved via getDoc (async) -> rich-text editor mounts inline; list stays.
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_a')
    expect(screen.getByText('Doc A')).toBeTruthy()
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({ doc: 'd_a' })
    expect(assignSpy).not.toHaveBeenCalled()
    // First open from the list pushes the doc entry over a normalised list entry (XIN-1172).
    expect(String(pushStateSpy.mock.calls.at(-1)![2])).toContain('doc=d_a')
    expect(String(replaceStateSpy.mock.calls.at(-1)![2])).not.toContain('doc=')
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
    // no longer a resident headerRight button). The list item carries no docType, so the editor
    // mounts only after the async open resolves — wait for it before reaching for the entry.
    const entry = await waitFor(() => screen.getByTestId('editor-open-new-page'))
    fireEvent.click(entry)

    // It opens the clean standalone deep-link in a new tab — no in-app navigation. The link carries
    // the doc's real space as `?sp` (XIN-519 blocker 1); with no active space the shell falls back to
    // the default doc space ('demo'). No `?sid` — the opener's session is recovered from storage.
    expect(openSpy).toHaveBeenCalledWith('/d/d_a?sp=demo', '_blank', 'noopener,noreferrer')
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('XIN-513/519: the standalone link opens with `?sp` (doc space) but no `?sid`, even when the in-shell URL carries a sid', async () => {
    const openSpy = vi.fn()
    Object.defineProperty(window, 'open', { configurable: true, writable: true, value: openSpy })
    // In-shell URL carries the active session's sid (the host's RouteManager re-push collapses the
    // docs route to `/docs?sid=…`). The opened standalone link must NOT copy that sid forward: an
    // already-logged-in user's session is recovered from storage independently of the URL (XIN-513),
    // so a sid-less `/d/:docId` opens the document directly. It MUST, however, carry `?sp` (the doc's
    // real space) so the recipient's standalone preflight can address the doc's own space — dropping
    // it (XIN-519 blocker 1) sent the login-return path into the cross-space not_found terminal.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://app.example.com', search: '?sid=s_active', assign: assignSpy },
    })
    const wk = createMockWKApp()
    // Give the shell an active space so DocsHome's space (spaceRef) resolves to a real doc space id,
    // which the opened standalone link must carry as `?sp`.
    wk.shared.currentSpaceId = '105d4a60d0fc4d55a5cfc3c2d0501361'
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
    // The list item carries no docType, so the editor mounts only after the async open resolves.
    fireEvent.click(await waitFor(() => screen.getByTestId('editor-open-new-page')))

    // The standalone link carries `?sp` (the doc's real space) so the recipient's preflight addresses
    // the doc's own space — but NO `?sid`; the opener's session is recovered from storage (XIN-513).
    // (The multi-session wrong-space-session recovery edge is tracked separately as octo-web #551.)
    expect(openSpy).toHaveBeenCalledWith(
      '/d/d_a?sp=105d4a60d0fc4d55a5cfc3c2d0501361',
      '_blank',
      'noopener,noreferrer',
    )
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
      // Unknown-kind deep-link: the per-doc GET resolves the authoritative kind (here a plain
      // doc) before a shell is chosen, exactly as the list-open path does.
      if (method === 'get' && url === '/docs/d_persist') {
        return { data: { docId: 'd_persist', title: 'Persisted', role: 'admin', docType: 'doc' }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_persist')
  })

  it('opens the whiteboard inline from a direct deep-link whose kind is only known to the backend (owner direct-open, XIN-132)', async () => {
    // The owner direct-open bug: a direct `/docs?doc=<board>` deep-link resolved kind from the
    // local registry ONLY and never fetched doc metadata, so an owner opening a whiteboard link
    // (registry empty in that session) fell back to the rich-text editor (canvas=0). The fix
    // resolves the authoritative docType via getDoc — the board shell must open, not the editor.
    window.sessionStorage.setItem(
      TARGET_KEY,
      JSON.stringify({ space: 'sp', folder: 'fd', doc: 'b_direct' }),
    )
    const wk = createMockWKApp()
    setWKApp(wk)
    const calls: Array<{ method: string; url: string }> = []
    wk.apiClient.responder = (method, url) => {
      calls.push({ method, url })
      if (method === 'get' && url === '/docs/b_direct') {
        return { data: { docId: 'b_direct', title: 'Board', role: 'admin', docType: 'board' }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // Whiteboard shell mounts after the authoritative kind lookup — NOT the rich-text editor.
    await waitFor(() => expect(screen.getByTestId('board-shell')).toBeTruthy())
    expect(screen.getByTestId('board-doc').textContent).toBe('b_direct')
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    // The kind was fetched because neither the registry nor a stored docType could assert it.
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/b_direct')).toBe(true)
    // The resolved kind is mirrored so the host's query-wiping re-render re-opens the board.
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      doc: 'b_direct',
      docType: 'board',
    })
  })

  it('opens a board deep-link directly when this client already knows it is a board (no round-trip)', async () => {
    // The owner on the SAME browser that created the board: the local registry asserts the kind,
    // so the whiteboard opens immediately with no per-doc lookup (the fast path is preserved).
    window.sessionStorage.setItem(
      TARGET_KEY,
      JSON.stringify({ space: 'sp', folder: 'fd', doc: 'b_known', docType: 'board' }),
    )
    const wk = createMockWKApp()
    setWKApp(wk)
    const calls: Array<{ method: string; url: string }> = []
    wk.apiClient.responder = (method, url) => {
      calls.push({ method, url })
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    expect(screen.getByTestId('board-shell')).toBeTruthy()
    expect(screen.getByTestId('board-doc').textContent).toBe('b_known')
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/b_known')).toBe(false)
  })

  it('back-to-list unmounts the editor and clears the persisted target (no full navigation)', async () => {
    window.sessionStorage.setItem(TARGET_KEY, JSON.stringify({ doc: 'd_persist' }))
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_persist') {
        return { data: { docId: 'd_persist', title: 'Persisted', role: 'admin', docType: 'doc' }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // The unknown-kind deep-link resolves to the editor via getDoc, then the back control appears.
    await waitFor(() => expect(screen.getByTestId('editor-back')).toBeTruthy())
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
    // The editor for the doc opened under space-a is mounted (the async open resolves post-render).
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
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
    // Wait for the async open to mount the editor before broadcasting the redundant event.
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())

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

    // The default tab is "recent" (最近查看), which lists via GET /docs/recent — it carries NO
    // spaceId query (space is server-derived from the token / X-Space-Id header), so we key deferred
    // resolvers by the live `currentSpaceId` read at call time instead of parsing the URL. This
    // keeps the P0 guard covering the actual rendered rows now that recent is the default surface.
    const deferred: Record<string, (items: unknown[]) => void> = {}
    wk.apiClient.responder = (method, url) => {
      // The recent tab also fetches its creator candidates; answer that sibling GET immediately so
      // only the paged-list request lands in `deferred`.
      if (method === 'get' && url.startsWith('/docs/recent/creators')) {
        return { data: { creators: [] }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs/recent')) {
        const spaceId = wk.shared.currentSpaceId ?? ''
        return new Promise((resolve) => {
          deferred[spaceId] = (items) =>
            resolve({ data: { total: items.length, items, nextCursor: null }, status: 200 })
        })
      }
      return { data: { total: 0, items: [], nextCursor: null }, status: 200 }
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

    // ...then let the OLDER (space-a) request resolve LAST (out of order). Without the per-view
    // seqRef guard this stale setItems would clobber the list with the old Space's doc.
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
      if (method === 'get' && url === '/docs/d_persist') {
        return { data: { docId: 'd_persist', title: 'Persisted', role: 'admin', docType: 'doc' }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    // The unknown-kind deep-link resolves via getDoc, then the editor element is pushed into the
    // right pane. Wait for that specific push (the earlier empty-state push isn't the editor).
    await waitFor(() => {
      const last = replaceToRoot.mock.calls.at(-1)?.[0] as { props?: { docId?: string } } | undefined
      expect(last?.props?.docId).toBe('d_persist')
    })
    const pushed = replaceToRoot.mock.calls.at(-1)![0] as {
      props: { docId: string; onBack?: unknown; onExit?: unknown }
    }
    expect(pushed.props.docId).toBe('d_persist')
    expect(pushed.props.onBack).toBeUndefined()
    expect(typeof pushed.props.onExit).toBe('function')
  })
})

// Opening a list item must pick the right shell for EVERY member, not just the board's creator.
// The M2 routing bug: board-kind detection fell back to a creator-local localStorage registry, so
// a NON-creator (whose registry is empty) opening a shared board whose list row carried no
// docType landed in the rich-text editor (canvas=0). Fix: when the kind is unknown, openDoc
// resolves the authoritative docType from the per-doc GET (/docs/{id}) before choosing a shell.
describe('DocsHome — list-open shell selection by docType (XIN-58)', () => {
  // Build a DocsHome wired to a single list item + a per-doc GET, recording every request so a
  // test can assert whether the authoritative kind lookup (GET /docs/{id}) was made.
  function renderWithDoc(opts: {
    listDocType?: string // docType the list API echoes for the row (undefined = omitted)
    metaDocType?: string // docType the per-doc GET returns (undefined = omitted/legacy)
    metaThrows?: boolean // simulate the per-doc GET failing
  }): { calls: Array<{ method: string; url: string }> } {
    const wk = createMockWKApp()
    setWKApp(wk)
    const calls: Array<{ method: string; url: string }> = []
    wk.apiClient.responder = (method, url) => {
      calls.push({ method, url })
      if (method === 'get' && url === '/docs/d_x') {
        if (opts.metaThrows) throw new Error('per-doc GET failed')
        return {
          data: { docId: 'd_x', title: 'Shared X', role: 'admin', docType: opts.metaDocType },
          status: 200,
        }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return {
          data: {
            total: 1,
            items: [
              { docId: 'd_x', title: 'Shared X', ownerId: 'u_owner', role: 'admin', docType: opts.listDocType },
            ],
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }
    render(<DocsHome />)
    return { calls }
  }

  it('docType=board from the list opens the board shell directly (no per-doc lookup)', async () => {
    const { calls } = renderWithDoc({ listDocType: 'board' })
    await waitFor(() => expect(screen.getByText('Shared X')).toBeTruthy())

    fireEvent.click(screen.getByText('Shared X'))

    await waitFor(() => expect(screen.getByTestId('board-shell')).toBeTruthy())
    expect(screen.getByTestId('board-doc').textContent).toBe('d_x')
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    // The kind was already known — no authoritative round-trip needed.
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/d_x')).toBe(false)
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      doc: 'd_x',
      docType: 'board',
    })
  })

  it('docType=doc from the list opens the rich-text editor directly (no per-doc lookup)', async () => {
    const { calls } = renderWithDoc({ listDocType: 'doc' })
    await waitFor(() => expect(screen.getByText('Shared X')).toBeTruthy())

    fireEvent.click(screen.getByText('Shared X'))

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_x')
    expect(screen.queryByTestId('board-shell')).toBeNull()
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/d_x')).toBe(false)
  })

  it('unknown kind (list omits docType, non-creator) resolves a board via getDoc → board shell', async () => {
    // The core regression: registry is empty (non-creator) and the list row has no docType, yet
    // the per-doc GET says board — so the board shell must open, NOT the rich-text editor.
    const { calls } = renderWithDoc({ listDocType: undefined, metaDocType: 'board' })
    await waitFor(() => expect(screen.getByText('Shared X')).toBeTruthy())

    fireEvent.click(screen.getByText('Shared X'))

    await waitFor(() => expect(screen.getByTestId('board-shell')).toBeTruthy())
    expect(screen.getByTestId('board-doc').textContent).toBe('d_x')
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    // The authoritative kind was fetched because the list row didn't carry it.
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/d_x')).toBe(true)
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      doc: 'd_x',
      docType: 'board',
    })
  })

  it('unknown kind resolving to a non-board (or a failed lookup) opens the rich-text editor', async () => {
    // getDoc that doesn't confirm a board → safe default to the editor (legacy docs).
    const { calls } = renderWithDoc({ listDocType: undefined, metaThrows: true })
    await waitFor(() => expect(screen.getByText('Shared X')).toBeTruthy())

    fireEvent.click(screen.getByText('Shared X'))

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_x')
    expect(screen.queryByTestId('board-shell')).toBeNull()
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/d_x')).toBe(true)
  })
})

// Regression: the XIN-517 re-rebase against upstream #537 (Univer sheet-collab) collapsed the
// spreadsheet OPEN path — openDoc squashed a resolved `'sheet'` down to `'doc'` before
// buildRightPane dispatched, so every entry point to a sheet (create / Excel import / existing
// list row / deep-link) mounted the Tiptap editor instead of Univer SheetView. openDoc now
// preserves `'sheet'` all the way through, mirroring base #537's behavior. These lock the sheet
// path per-entry-point without regressing the board / doc paths above.
describe('DocsHome — sheet open path restored (XIN-520)', () => {
  it('creates a sheet via the New dropdown and opens it in the Univer sheet view (not the editor)', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    const calls: Array<{ method: string; url: string; body?: unknown }> = []
    wk.apiClient.responder = (method, url, body) => {
      calls.push({ method, url, body })
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      if (method === 'post' && url === '/docs') {
        return {
          data: {
            docId: 's_new',
            documentName: 'doc:s_new',
            title: '',
            spaceId: 'demo',
            folderId: 'f_default',
            ownerId: 'u_self',
            role: 'admin',
            docType: 'sheet',
          },
          status: 201,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('docs.state.empty')).toBeTruthy())

    // Open the split "New" dropdown and choose "New sheet".
    fireEvent.click(screen.getByLabelText('docs.list.newMenu'))
    fireEvent.click(screen.getByText('docs.sheet.new', { exact: false }))

    // The Univer sheet view (not the rich-text editor) opens inline.
    await waitFor(() => expect(screen.getByTestId('sheet-view')).toBeTruthy())
    expect(screen.getByTestId('sheet-doc').textContent).toBe('s_new')
    expect(screen.queryByTestId('editor-shell')).toBeNull()

    // createDoc was sent with the sheet kind through the docType seam.
    const create = calls.find((c) => c.method === 'post' && c.url === '/docs')
    expect((create?.body as { docType?: string })?.docType).toBe('sheet')

    // Selection persisted with its kind so a refresh re-opens the sheet view.
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      doc: 's_new',
      docType: 'sheet',
    })
  })

  it('opens an existing sheet row directly in the sheet view (no per-doc lookup)', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    const calls: Array<{ method: string; url: string }> = []
    wk.apiClient.responder = (method, url) => {
      calls.push({ method, url })
      if (method === 'get' && url.startsWith('/docs')) {
        return {
          data: {
            total: 1,
            items: [
              { docId: 's_row', title: 'Budget', ownerId: 'u_owner', role: 'admin', docType: 'sheet' },
            ],
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('Budget')).toBeTruthy())

    fireEvent.click(screen.getByText('Budget'))

    await waitFor(() => expect(screen.getByTestId('sheet-view')).toBeTruthy())
    expect(screen.getByTestId('sheet-doc').textContent).toBe('s_row')
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    // The list row already carried docType='sheet' — no authoritative round-trip needed.
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/s_row')).toBe(false)
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      doc: 's_row',
      docType: 'sheet',
    })
  })

  it('opens a sheet from a `?doc=<sheetId>` deep-link whose kind only the backend knows', async () => {
    // Unknown-kind deep-link (registry empty, no stored docType): the per-doc GET resolves
    // docType='sheet', so the Univer sheet view must open — NOT the rich-text editor.
    window.sessionStorage.setItem(
      TARGET_KEY,
      JSON.stringify({ space: 'sp', folder: 'fd', doc: 's_direct' }),
    )
    const wk = createMockWKApp()
    setWKApp(wk)
    const calls: Array<{ method: string; url: string }> = []
    wk.apiClient.responder = (method, url) => {
      calls.push({ method, url })
      if (method === 'get' && url === '/docs/s_direct') {
        return { data: { docId: 's_direct', title: 'Shared sheet', role: 'admin', docType: 'sheet' }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByTestId('sheet-view')).toBeTruthy())
    expect(screen.getByTestId('sheet-doc').textContent).toBe('s_direct')
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    // The kind was fetched because neither the registry nor a stored docType could assert it.
    expect(calls.some((c) => c.method === 'get' && c.url === '/docs/s_direct')).toBe(true)
    // The resolved kind is mirrored so the host's query-wiping re-render re-opens the sheet.
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({
      doc: 's_direct',
      docType: 'sheet',
    })
  })
})

// Regression (XIN-528): an in-flight unknown-kind open must NOT reopen the previous Space's doc.
// openDoc's unknown-kind branch fires getDoc(docId) and commits in the .then(); the only staleness
// guard used to be `latestOpenRef.current === docId`. A Space switch runs backToList (the
// onSpaceChanged reconciler) which cleared the pane but did NOT reset latestOpenRef, so a getDoc
// that resolved AFTER the switch still passed the guard and commitOpen ran for the old-Space doc —
// setting selectedDoc + persistDocTarget({space: oldSpace}) + pushing the old doc into the right
// pane while the list had already moved to the new Space. This is the async twin of the synchronous
// cross-Space carry the PR fixes elsewhere. The fix: backToList resets latestOpenRef.current=null
// AND openDoc's guard is Space-scoped, so a resolve after a switch is discarded.
describe('DocsHome — in-flight unknown-kind open is discarded after a Space switch (XIN-528)', () => {
  it('does not commit the old-Space doc when getDoc resolves after backToList', async () => {
    const wk = createMockWKApp()
    wk.shared.currentSpaceId = 'space-a'
    const replaceToRoot = vi.fn()
    // Production (resident-list) path so we can observe what the reconciler pushes into the pane.
    ;(wk as { routeRight?: unknown }).routeRight = { replaceToRoot, popToRoot: vi.fn() }
    setWKApp(wk)

    // Hold the unknown-kind per-doc GET in flight so the test can switch Space BEFORE it resolves.
    let resolveMeta: (() => void) | undefined
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_a') {
        return new Promise((resolve) => {
          resolveMeta = () =>
            resolve({
              data: { docId: 'd_a', title: 'Space A Doc', role: 'admin', docType: 'board' },
              status: 200,
            })
        })
      }
      if (method === 'get' && url.startsWith('/docs/recent/creators')) {
        return { data: { creators: [] }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs/recent')) {
        // The default tab lists via GET /docs/recent (no spaceId query — space is server-derived),
        // so branch on the live current Space: only the initial Space lists the unknown-kind row;
        // the new Space is empty.
        if (wk.shared.currentSpaceId === 'space-a') {
          return {
            data: {
              total: 1,
              items: [{ docId: 'd_a', title: 'Space A Doc', ownerId: 'u_owner', role: 'admin' }],
              nextCursor: null,
            },
            status: 200,
          }
        }
        return { data: { total: 0, items: [], nextCursor: null }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('Space A Doc')).toBeTruthy())

    // Open the unknown-kind row → openDoc fires getDoc('/docs/d_a'), held in flight below.
    fireEvent.click(screen.getByText('Space A Doc'))
    await waitFor(() => expect(resolveMeta).toBeTruthy())

    // Host switches Space WHILE the getDoc is still pending: mutate currentSpaceId then broadcast.
    // backToList runs, clearing the pane and (with the fix) invalidating the pending open token.
    wk.shared.currentSpaceId = 'space-b'
    wk.mockMittBus.emitSpaceChanged({ space_id: 'space-b' })

    // Now let the stale getDoc resolve LAST. Without the fix, commitOpen would run for d_a.
    resolveMeta!()
    // Give the resolved promise a chance to (wrongly) commit before asserting.
    await new Promise((r) => setTimeout(r, 20))

    // The old-Space doc must NOT open: no board shell for d_a, no selection, and the persisted
    // target must not have been (re)written to the old Space's doc (backToList cleared it).
    expect(screen.queryByTestId('board-shell')).toBeNull()
    expect(screen.queryByTestId('board-doc')).toBeNull()
    expect(window.sessionStorage.getItem(TARGET_KEY)).toBeNull()
    // The last thing pushed into the right pane is the empty state (backToList), never the d_a doc.
    const lastPush = replaceToRoot.mock.calls.at(-1)?.[0] as
      | { props?: { docId?: string } }
      | undefined
    expect(lastPush?.props?.docId).toBeUndefined()
  })
})

// Deleting the currently-open doc must clear the right pane and the selection, not just refresh the
// list. Regression (XIN-1050): onDocDeleted guarded `docId === selectedDocId` against a STALE
// closed-over selectedDocId. In the production (routeRight) path the shell is pushed into the host
// pane as a one-time element snapshot by commitOpen — and that push runs synchronously right after
// setSelectedDocId(X), before the state re-render — so the onDocDeleted baked into the snapshot
// still saw the PRE-open id (null on first open, the previous doc on a switch). The guard therefore
// never matched the just-opened doc, backToList never ran, and the deleted doc's shell stayed
// resident in the right pane while only the list refreshed. doc / sheet / board share the single
// onDocDeleted, so all three regressed. The fix reads selectedDocIdRef (the always-current id).
// This test drives the exact snapshot path: it invokes the onDeleted wired into the pushed element,
// as the shell does after a successful in-editor delete of the open doc.
describe('DocsHome — deleting the open doc clears the right pane and selection (XIN-1050)', () => {
  const shells: Array<{ kind: 'doc' | 'sheet' | 'board'; docType: string }> = [
    { kind: 'doc', docType: 'doc' },
    { kind: 'sheet', docType: 'sheet' },
    { kind: 'board', docType: 'board' },
  ]

  for (const { kind, docType } of shells) {
    it(`resets routeRight to the empty state and clears selection after deleting the open ${kind}`, async () => {
      const wk = createMockWKApp()
      const replaceToRoot = vi.fn()
      // Production (resident-list) path so the shell is pushed into the host pane as a snapshot —
      // the only path where the stale-closure bug manifests (the inline path rebuilds the shell
      // every render, so its onDocDeleted is always current).
      ;(wk as { routeRight?: unknown }).routeRight = { replaceToRoot, popToRoot: vi.fn() }
      setWKApp(wk)
      wk.apiClient.responder = (method, url) => {
        if (method === 'get' && url.startsWith('/docs')) {
          return {
            data: {
              total: 1,
              items: [
                { docId: 'd_x', title: 'Open Doc', ownerId: 'u_self', role: 'admin', docType },
              ],
            },
            status: 200,
          }
        }
        return { data: {}, status: 200 }
      }

      render(<DocsHome />)
      await waitFor(() => expect(screen.getByText('Open Doc')).toBeTruthy())

      // Known-kind row → openDoc commits synchronously and pushes the matching shell into the host
      // pane. Wait for that push (the earlier mount empty-state push is not the shell).
      fireEvent.click(screen.getByText('Open Doc'))
      await waitFor(() => {
        const last = replaceToRoot.mock.calls.at(-1)?.[0] as
          | { props?: { docId?: string } }
          | undefined
        expect(last?.props?.docId).toBe('d_x')
      })
      // The just-opened row is marked active (selectedDocId === 'd_x').
      await waitFor(() =>
        expect(document.querySelector('.octo-docs-list-item-active')).toBeTruthy(),
      )
      // The durable target was persisted for the open doc.
      expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({ doc: 'd_x' })

      // Fire the onDeleted baked into the pushed shell snapshot, exactly as the shell does after a
      // successful in-editor delete of the open doc.
      const pushed = replaceToRoot.mock.calls.at(-1)![0] as {
        props: { docId: string; onDeleted: (id: string) => void }
      }
      expect(typeof pushed.props.onDeleted).toBe('function')
      act(() => pushed.props.onDeleted('d_x'))

      // routeRight is cleared to the docs empty state — NOT left showing the deleted doc's shell.
      await waitFor(() => {
        const last = replaceToRoot.mock.calls.at(-1)?.[0] as
          | { props?: { docId?: string } }
          | undefined
        expect(last?.props?.docId).toBeUndefined()
      })
      // selectedDocId is reset: no list row stays active and the persisted target is cleared.
      expect(document.querySelector('.octo-docs-list-item-active')).toBeNull()
      expect(window.sessionStorage.getItem(TARGET_KEY)).toBeNull()
    })
  }

  it('refreshes the list but keeps the pane when a DIFFERENT (not-open) doc is deleted', async () => {
    const wk = createMockWKApp()
    const replaceToRoot = vi.fn()
    ;(wk as { routeRight?: unknown }).routeRight = { replaceToRoot, popToRoot: vi.fn() }
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return {
          data: {
            total: 1,
            items: [{ docId: 'd_x', title: 'Open Doc', ownerId: 'u_self', role: 'admin', docType: 'doc' }],
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('Open Doc')).toBeTruthy())
    fireEvent.click(screen.getByText('Open Doc'))
    await waitFor(() => {
      const last = replaceToRoot.mock.calls.at(-1)?.[0] as { props?: { docId?: string } } | undefined
      expect(last?.props?.docId).toBe('d_x')
    })

    const pushed = replaceToRoot.mock.calls.at(-1)![0] as {
      props: { onDeleted: (id: string) => void }
    }
    // A doc other than the open one is deleted elsewhere: the open doc must stay resident.
    act(() => pushed.props.onDeleted('d_other'))

    // The right pane still shows the open doc (no empty-state push) and the target is intact —
    // only the resident list is refreshed (via the reload-token bump).
    const last = replaceToRoot.mock.calls.at(-1)?.[0] as { props?: { docId?: string } } | undefined
    expect(last?.props?.docId).toBe('d_x')
    expect(JSON.parse(window.sessionStorage.getItem(TARGET_KEY)!)).toMatchObject({ doc: 'd_x' })
  })
})

// XIN-1172 — opening a doc → browser Back / Back-then-reload landed on about:blank because the
// open only replaceState'd the current entry (no in-app entry to go Back to) and the persisted
// target re-opened the doc on the host's popstate re-push. The fix pushes a doc entry over a
// normalised list entry and reconciles popstate to the list, clearing the target.
describe('readDocFromHistory (XIN-1172 Back/Forward intent)', () => {
  it('returns the docId when the entry is marked as a doc entry', () => {
    expect(readDocFromHistory({ octoDocsDoc: 'd_open' }, '')).toBe('d_open')
  })

  it('returns null (list) when the entry is marked as the list entry', () => {
    // Even if a stale ?doc= lingers in the URL, an explicit list marker wins → show the list.
    expect(readDocFromHistory({ octoDocsList: true }, '?doc=d_stale')).toBeNull()
  })

  it('falls back to the URL query when the state carries no marker (host re-push overwrote it)', () => {
    expect(readDocFromHistory({}, '?space=s&folder=f&doc=d_url')).toBe('d_url')
    expect(readDocFromHistory(null, '?sid=abc')).toBeNull()
  })

  it('accepts docId as an alias in the URL fallback', () => {
    expect(readDocFromHistory(undefined, '?docId=d_alias')).toBe('d_alias')
  })
})

describe('DocsHome — browser Back returns to the list, never about:blank (XIN-1172)', () => {
  it('pushes a doc entry over a normalised list entry so Back has a list to return to', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs')) {
        return {
          data: {
            total: 1,
            items: [{ docId: 'd_a', title: 'Doc A', ownerId: 'u_self', role: 'admin', docType: 'doc' }],
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByText('Doc A')).toBeTruthy())
    fireEvent.click(screen.getByText('Doc A'))
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())

    // The current entry was normalised to the list (no doc), then the doc was pushed on top —
    // guaranteeing an in-app list entry beneath so a browser Back never pops past /docs.
    const listReplace = replaceStateSpy.mock.calls.at(-1)!
    expect(String(listReplace[2])).not.toContain('doc=')
    expect((listReplace[0] as Record<string, unknown>).octoDocsList).toBe(true)
    const docPush = pushStateSpy.mock.calls.at(-1)!
    expect(String(docPush[2])).toContain('doc=d_a')
    expect((docPush[0] as Record<string, unknown>).octoDocsDoc).toBe('d_a')
  })

  it('on popstate to a non-doc entry, closes the doc and clears the persisted target (Back → list)', async () => {
    // A doc is open via a persisted target (mirrors the host having re-opened it before a Back).
    window.sessionStorage.setItem(TARGET_KEY, JSON.stringify({ doc: 'd_persist' }))
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_persist') {
        return { data: { docId: 'd_persist', title: 'Persisted', role: 'admin', docType: 'doc' }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<DocsHome />)
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())

    // Simulate the browser Back popping to the list entry (history.state is the mocked no-op, so
    // readDocFromHistory sees no doc marker and the empty URL → "this is the list").
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    // The editor is dismissed and the persisted target is cleared, so the host's own popstate
    // re-push (which re-mounts DocsHome reading sessionStorage) cannot re-open the doc — and a
    // reload of the now doc-less /docs URL lands on the list, not a blank page.
    await waitFor(() => expect(screen.queryByTestId('editor-shell')).toBeNull())
    expect(window.sessionStorage.getItem(TARGET_KEY)).toBeNull()
    expect(assignSpy).not.toHaveBeenCalled()
  })
})

describe('DocsHome — pin order survives the search → pin → clear-search re-render (XIN-1185)', () => {
  // Reproduces the exact tester path reported against FEAT-B: 我的文档 → search "FEAT" → right-click
  // pin the matching doc → clear the search. The suspicion was that the post-clear re-fetch drops the
  // pin ordering. The client-side pin is React/localStorage state on DocsHome, and `displayItems`
  // re-applies a stable pinned-first sort over EVERY mine result set — including the fresh list the
  // cleared search re-fetches — so a doc pinned while filtered must float to the first row afterward.
  const item = (docId: string, title: string, updatedAt: string) => ({
    docId,
    title,
    ownerId: 'u_self',
    role: 'admin' as const,
    updatedAt,
  })
  // Server order for the unfiltered "mine" list is updatedAt:desc, so FEAT spec is NOT first here.
  const FULL = [
    item('d_alpha', 'Alpha', '2026-07-10T00:00:00Z'),
    item('d_feat', 'FEAT spec', '2026-07-09T00:00:00Z'),
    item('d_beta', 'Beta', '2026-07-08T00:00:00Z'),
  ]

  const rowTitles = () =>
    Array.from(document.querySelectorAll('.octo-docs-list-row-title')).map(
      (el) => el.textContent ?? '',
    )

  it('floats a doc pinned while a search is active to the top after the search is cleared', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs/recent/creators')) {
        return { data: { creators: [] }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs/recent')) {
        return { data: { total: 0, items: [], nextCursor: null }, status: 200 }
      }
      if (method === 'get' && url.includes('owner=me')) {
        // The "search FEAT" request narrows the list to the single matching doc.
        if (url.includes('q=FEAT')) {
          return { data: { total: 1, items: [FULL[1]] }, status: 200 }
        }
        return { data: { total: FULL.length, items: FULL }, status: 200 }
      }
      return { data: { total: 0, items: [] }, status: 200 }
    }

    render(<DocsHome />)

    // 我的文档 tab.
    fireEvent.click(screen.getByText('docs.tab.mine'))
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())
    // Baseline: server order, FEAT spec is not first.
    expect(rowTitles()[0]).toBe('Alpha')

    // search "FEAT" (SearchBox debounces ~300ms before emitting the query).
    fireEvent.change(screen.getByPlaceholderText('docs.search.placeholder'), {
      target: { value: 'FEAT' },
    })
    await waitFor(() => {
      const titles = rowTitles()
      expect(titles).toEqual(['FEAT spec'])
    })

    // right-click the matching row → pin it.
    fireEvent.contextMenu(screen.getByText('FEAT spec').closest('button')!)
    fireEvent.click(screen.getByText('docs.sheet.pin'))
    // Pin persisted to localStorage (the durable client-side pin store).
    expect(JSON.parse(window.localStorage.getItem('octo.docs.pinned') || '[]')).toContain('d_feat')

    // clear the search → the full list is re-fetched and re-rendered.
    fireEvent.click(screen.getByLabelText('docs.empty.searchNoneCta'))
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy())

    // The pinned doc floats to the FIRST row over the server's updatedAt:desc order; the rest keep
    // their server order beneath it (stable sort).
    expect(rowTitles()).toEqual(['FEAT spec', 'Alpha', 'Beta'])
  })
})

// XIN-1188: the list distinguishes doc / sheet / board rows by icon (three-way), and the type
// filter control is present on BOTH tabs (creator is recent-only).
describe('DocsHome — type distinction + filter (XIN-1188)', () => {
  const recentRows = [
    { docId: 'd_doc', title: 'A Doc', ownerId: 'u_o', role: 'admin', docType: 'doc', viewedAt: '2026-07-15T06:00:00.000Z' },
    { docId: 'd_sheet', title: 'A Sheet', ownerId: 'u_o', role: 'admin', docType: 'sheet', viewedAt: '2026-07-15T05:00:00.000Z' },
    { docId: 'd_board', title: 'A Board', ownerId: 'u_o', role: 'admin', docType: 'board', viewedAt: '2026-07-15T04:00:00.000Z' },
  ]

  function mountList() {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs/recent/creators')) {
        return { data: { creators: [] }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs/recent')) {
        return { data: { total: recentRows.length, items: recentRows, nextCursor: null }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        // mine tab (owner=me)
        return { data: { total: 1, items: [recentRows[0]] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<DocsHome />)
    return wk
  }

  it('renders three distinct row-kind icons/labels (sheet is NOT shown as a document)', async () => {
    mountList()
    await waitFor(() => expect(screen.getByText('A Sheet')).toBeTruthy())
    // Each kind carries its own aria-label/title on the row icon.
    expect(screen.getByLabelText('docs.list.kindDoc')).toBeTruthy()
    expect(screen.getByLabelText('docs.list.kindSheet')).toBeTruthy()
    expect(screen.getByLabelText('docs.list.kindBoard')).toBeTruthy()
  })

  it('shows the type filter on both tabs and drives a multi-select OR request', async () => {
    const wk = mountList()
    await waitFor(() => expect(screen.getByText('A Sheet')).toBeTruthy())

    // Type filter present on the recent tab.
    const typeBtn = screen.getByText('docs.filter.type')
    expect(typeBtn).toBeTruthy()

    // Open the dropdown and select "sheet" → the next recent request narrows on type=sheet.
    fireEvent.click(typeBtn)
    fireEvent.click(screen.getByText('docs.list.kindSheet'))
    await waitFor(() => {
      const lastRecent = wk.apiClient.calls
        .filter((c) => c.method === 'get' && c.url.startsWith('/docs/recent?'))
        .at(-1)
      expect(lastRecent?.url).toContain('type=sheet')
    })

    // Switch to the mine tab — the type filter is still rendered there.
    fireEvent.click(screen.getByText('docs.tab.mine'))
    await waitFor(() => expect(screen.getByText('docs.filter.type')).toBeTruthy())
  })
})

// XIN-1236 (merged design): recent rows keep the creator on its own line, then show ONE merged
// time line reporting only the LATEST event — "<updater> updated X" when the doc was updated after
// the user last viewed it, otherwise "you viewed X". The two timestamps are never stacked, so the
// creator's name can never be misread as the viewer/updater.
describe('DocsHome — recent row merges viewed/updated into the latest event (XIN-1236)', () => {
  function mountList(rows: Array<Record<string, unknown>>) {
    const wk = createMockWKApp()
    setWKApp(wk)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url.startsWith('/docs/recent/creators')) {
        return { data: { creators: [{ uid: 'u_owner', name: 'Owner Name' }] }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs/recent')) {
        return { data: { total: rows.length, items: rows, nextCursor: null }, status: 200 }
      }
      if (method === 'get' && url.startsWith('/docs')) {
        return { data: { total: 0, items: [] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<DocsHome />)
    return wk
  }

  async function rowFor(title: string): Promise<HTMLElement> {
    return waitFor(() => {
      const el = screen.getByText(title).closest('.octo-docs-list-item')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
  }

  it('shows the creator line plus a single "you viewed" line when the view is the latest event', async () => {
    // viewedAt (07-15) is newer than updatedAt (07-14): the merged line is the VIEW.
    mountList([
      {
        docId: 'd_view',
        title: 'Viewed Latest',
        ownerId: 'u_owner',
        role: 'admin',
        docType: 'doc',
        viewedAt: '2026-07-15T06:00:00.000Z',
        updatedAt: '2026-07-14T06:00:00.000Z',
        updatedBy: { uid: 'u_editor', name: 'Editor Name' },
      },
    ])
    const row = await rowFor('Viewed Latest')

    const creator = row.querySelector('.octo-docs-list-row-creator')
    expect(creator).toBeTruthy()
    expect(creator!.textContent).toContain('docs.list.createdBy')
    expect(creator!.textContent).toContain('Owner Name')

    // The view wins → a single "you viewed" line, and NO updated line stacked beneath it.
    const viewed = row.querySelector('.octo-docs-list-row-viewed')
    expect(viewed).toBeTruthy()
    expect(viewed!.textContent).toContain('docs.list.viewedBySelf')
    expect(row.querySelector('.octo-docs-list-row-updated')).toBeNull()
  })

  it('shows "<updater> updated X" (with the updater name) when the update is the latest event', async () => {
    // updatedAt (07-16) is newer than viewedAt (07-15): the merged line is the UPDATE, labelled
    // with the last-updater's name (XIN-1240 updatedBy), never the creator's.
    mountList([
      {
        docId: 'd_upd',
        title: 'Updated Latest',
        ownerId: 'u_owner',
        role: 'admin',
        docType: 'doc',
        viewedAt: '2026-07-15T06:00:00.000Z',
        updatedAt: '2026-07-16T06:00:00.000Z',
        updatedBy: { uid: 'u_editor', name: 'Editor Name' },
      },
    ])
    const row = await rowFor('Updated Latest')

    // The update wins → the updated line uses the named "updatedBy" label; no viewed line remains.
    const updated = row.querySelector('.octo-docs-list-row-updated')
    expect(updated).toBeTruthy()
    expect(updated!.textContent).toContain('docs.list.updatedBy')
    expect(updated!.getAttribute('title')).toBeTruthy()
    expect(row.querySelector('.octo-docs-list-row-viewed')).toBeNull()
    // Creator line still present and independent.
    expect(row.querySelector('.octo-docs-list-row-creator')).toBeTruthy()
  })

  it('falls back to an unnamed "updated X" line when the update wins but updatedBy is null', async () => {
    mountList([
      {
        docId: 'd_upd_anon',
        title: 'Updated No Author',
        ownerId: 'u_owner',
        role: 'admin',
        docType: 'doc',
        viewedAt: '2026-07-15T06:00:00.000Z',
        updatedAt: '2026-07-16T06:00:00.000Z',
        updatedBy: null,
      },
    ])
    const row = await rowFor('Updated No Author')

    const updated = row.querySelector('.octo-docs-list-row-updated')
    expect(updated).toBeTruthy()
    // No updater name to show → the plain "updated" label, NOT the named "updatedBy" one.
    expect(updated!.textContent).toContain('docs.list.updatedAt')
    expect(updated!.textContent).not.toContain('docs.list.updatedBy')
    expect(row.querySelector('.octo-docs-list-row-viewed')).toBeNull()
  })

  it('prefers the view when the two timestamps are equal (equal/very-close → viewed)', async () => {
    mountList([
      {
        docId: 'd_eq',
        title: 'Equal Times',
        ownerId: 'u_owner',
        role: 'admin',
        docType: 'doc',
        viewedAt: '2026-07-15T06:00:00.000Z',
        updatedAt: '2026-07-15T06:00:00.000Z',
        updatedBy: { uid: 'u_editor', name: 'Editor Name' },
      },
    ])
    const row = await rowFor('Equal Times')

    expect(row.querySelector('.octo-docs-list-row-viewed')).toBeTruthy()
    expect(row.querySelector('.octo-docs-list-row-updated')).toBeNull()
  })

  it('omits recent-only markers on the "mine" tab (updated is shown inline there instead)', async () => {
    mountList([
      {
        docId: 'd_view',
        title: 'Viewed Latest',
        ownerId: 'u_owner',
        role: 'admin',
        docType: 'doc',
        viewedAt: '2026-07-15T06:00:00.000Z',
        updatedAt: '2026-07-14T06:00:00.000Z',
      },
    ])
    await waitFor(() => expect(screen.getByText('Viewed Latest')).toBeTruthy())

    fireEvent.click(screen.getByText('docs.tab.mine'))
    // The mine tab lists nothing here, so no recent-only markers should linger on screen.
    await waitFor(() => {
      expect(document.querySelector('.octo-docs-list-row-creator')).toBeNull()
      expect(document.querySelector('.octo-docs-list-row-viewed')).toBeNull()
      expect(document.querySelector('.octo-docs-list-row-updated')).toBeNull()
    })
  })
})
