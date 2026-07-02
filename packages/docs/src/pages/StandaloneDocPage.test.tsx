import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// Replace the heavy collaborative editor with a lightweight marker. This is the crux of the
// AC-12 acceptance: the standalone page's boundary states are driven entirely by the GET
// /api/v1/docs/{docId} PREFLIGHT, so they must render WITHOUT ever mounting Tiptap/Yjs/
// Hocuspocus — i.e. with NO WebSocket dependency. The marker echoes the docId it was addressed
// with and renders whatever headerRight (Copy link / Open in App) the page injected.
vi.mock('../editor/EditorShell.tsx', () => ({
  EditorShell: (props: { docId: string; onBack?: () => void; headerRight?: ReactNode }) => (
    <div data-testid="editor-shell">
      <span data-testid="editor-doc">{props.docId}</span>
      <div data-testid="editor-header-right">{props.headerRight}</div>
    </div>
  ),
}))

// useMemberNames pages the space-member seam; stub it to a stable empty map so these tests stay
// focused on the preflight gate and chrome.
vi.mock('../members/useMemberNames.ts', () => ({
  useMemberNames: () => new Map<string, string>(),
}))

import {
  StandaloneDocPage,
  parseStandaloneDocId,
  isStandaloneDocPath,
  STANDALONE_RETURN_KEY,
} from './StandaloneDocPage.tsx'

/** Axios-style rejection shape the docs error handlers read (`err.response.status`). */
function apiError(status: number) {
  return { response: { status } }
}

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  window.sessionStorage.clear()
  wk = createMockWKApp()
  setWKApp(wk)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('parseStandaloneDocId', () => {
  it('extracts the docId from /d/:docId (with or without a trailing slash)', () => {
    expect(parseStandaloneDocId('/d/d_abc123')).toBe('d_abc123')
    expect(parseStandaloneDocId('/d/d_abc123/')).toBe('d_abc123')
    expect(parseStandaloneDocId('/d/DOC-9_x')).toBe('DOC-9_x')
  })
  it('returns null for non-standalone paths', () => {
    expect(parseStandaloneDocId('/docs')).toBeNull()
    expect(parseStandaloneDocId('/docs?doc=x')).toBeNull()
    expect(parseStandaloneDocId('/d/')).toBeNull()
    expect(parseStandaloneDocId('/d')).toBeNull()
    expect(parseStandaloneDocId('/')).toBeNull()
    // A ':' would forge a second documentName segment — reject it.
    expect(parseStandaloneDocId('/d/a:b')).toBeNull()
    // Only a top-level /d/ path, not a nested one.
    expect(parseStandaloneDocId('/x/d/abc')).toBeNull()
  })
})

describe('isStandaloneDocPath', () => {
  it('claims the whole /d namespace so malformed ids are still intercepted (AC-9)', () => {
    // Well-formed links.
    expect(isStandaloneDocPath('/d/d_abc123')).toBe(true)
    expect(isStandaloneDocPath('/d/d_abc123/')).toBe(true)
    // Malformed / empty ids: still in the namespace → intercepted → not-found terminal, NOT the
    // app shell.
    expect(isStandaloneDocPath('/d/')).toBe(true)
    expect(isStandaloneDocPath('/d')).toBe(true)
    expect(isStandaloneDocPath('/d/a:b')).toBe(true)
  })
  it('does not claim unrelated paths', () => {
    expect(isStandaloneDocPath('/docs')).toBe(false)
    expect(isStandaloneDocPath('/docs?doc=x')).toBe(false)
    expect(isStandaloneDocPath('/')).toBe(false)
    // A nested /d/ is not the top-level standalone namespace.
    expect(isStandaloneDocPath('/x/d/abc')).toBe(false)
    // A different top-level segment that merely starts with "d".
    expect(isStandaloneDocPath('/docs/d/abc')).toBe(false)
    expect(isStandaloneDocPath('/download')).toBe(false)
  })
})

describe('StandaloneDocPage — preflight boundary states (no WebSocket)', () => {
  it('AC-12: a GET 409 (archived) renders the locked terminal and never mounts the editor', async () => {
    // Deterministic: the api.responder THROWS 409 for the per-doc GET. The page maps that to the
    // 'locked' terminal via terminalForCreateError, with only a Back control — no collab editor,
    // hence no WebSocket, is mounted.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_locked') throw apiError(409)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_locked" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.locked')).toBeTruthy(),
    )
    // The editor (and its WS transport) is never mounted on the archived path.
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    // Only a Back affordance is offered (no Share / Request access).
    expect(screen.getByText(/docs\.list\.back/)).toBeTruthy()
  })

  it('AC-7: a GET 403 renders the access-denied terminal, editor not mounted', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_forbidden') throw apiError(403)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_forbidden" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.forbidden')).toBeTruthy(),
    )
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('AC-10: a GET 404 renders the not-found terminal, editor not mounted', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_missing') throw apiError(404)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_missing" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.notFound')).toBeTruthy(),
    )
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('AC-11: a GET 401 renders the sign-in terminal and stashes the return target', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_locked_out') throw apiError(401)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_locked_out" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.login')).toBeTruthy(),
    )
    // The link is stashed so the post-login flow can bounce the user back to the doc.
    expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).not.toBeNull()
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('AC-9: a null docId (malformed /d/ link) renders not-found without any preflight', async () => {
    // The host Layout claims the whole /d namespace and passes null here for a malformed/empty id
    // (`/d/`, `/d/a:b`). The page must render the not-found terminal — NOT fall through to the app
    // shell — and must issue NO preflight (there is nothing valid to fetch).
    wk.apiClient.responder = (method, url) => {
      throw new Error(`unexpected request ${method} ${url}`)
    }

    render(<StandaloneDocPage docId={null} />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.notFound')).toBeTruthy(),
    )
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    // No GET /docs/... preflight was attempted for a malformed id.
    expect(wk.apiClient.calls.some((c) => c.url.startsWith('/docs/'))).toBe(false)
  })

  it('mounts the editor with Copy link + Open in App injected when the preflight succeeds', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_ok')
    // The standalone chrome is injected via EditorShell's headerRight prop.
    const right = screen.getByTestId('editor-header-right')
    expect(right.textContent).toContain('docs.standalone.copyLink')
    expect(right.textContent).toContain('docs.standalone.openInApp')
  })
})
