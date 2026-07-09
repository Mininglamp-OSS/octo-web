import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import type { DocMoreMenuItem } from '../editor/DocMoreMenu.tsx'

// Replace the heavy collaborative editor with a lightweight marker. This is the crux of the
// AC-12 acceptance: the standalone page's boundary states are driven entirely by the GET
// /api/v1/docs/{docId} PREFLIGHT, so they must render WITHOUT ever mounting Tiptap/Yjs/
// Hocuspocus — i.e. with NO WebSocket dependency. The marker echoes the docId it was addressed
// with and renders the ≡ "more" menu lead rows (Copy link) the page injected as clickable buttons.
vi.mock('../editor/EditorShell.tsx', () => ({
  EditorShell: (props: {
    docId: string
    space?: string
    onBack?: () => void
    moreMenuLeadItems?: DocMoreMenuItem[]
    creatorNicknameOnly?: boolean
  }) => (
    <div data-testid="editor-shell">
      <span data-testid="editor-doc">{props.docId}</span>
      <span data-testid="editor-space">{props.space}</span>
      <span data-testid="editor-creator-nickname-only">{String(!!props.creatorNicknameOnly)}</span>
      {/* The shared EditorShell renders its header "← back" control iff it receives onBack; expose
          that here so a test can assert the standalone editor view no longer offers it (XIN-416). */}
      {props.onBack && (
        <button data-testid="editor-back" onClick={props.onBack}>
          back
        </button>
      )}
      <ul data-testid="editor-more-lead">
        {(props.moreMenuLeadItems ?? []).map((it) => (
          <li key={it.key}>
            <button data-testid={`lead-${it.key}`} onClick={it.onClick}>
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
}))

// Replace the whiteboard session host (Excalidraw + Yjs + Hocuspocus) with a marker so the
// board-open path is testable in jsdom without mounting the heavy canvas / opening a WebSocket —
// exactly like the editor marker above. The marker echoes the docId + space it was addressed with.
vi.mock('../board/BoardSession.tsx', () => ({
  BoardSession: (props: { docId: string; space?: string; folder?: string }) => (
    <div data-testid="board-session">
      <span data-testid="board-doc">{props.docId}</span>
      <span data-testid="board-space">{props.space}</span>
      <span data-testid="board-folder">{props.folder}</span>
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
  standaloneFallbackSpace,
  standaloneLinkSpace,
  persistStandaloneReturn,
  consumeStandaloneReturn,
  withReturnSid,
  STANDALONE_RETURN_KEY,
} from './StandaloneDocPage.tsx'

/** Axios-style rejection shape the docs error handlers read (`err.response.status`). */
function apiError(status: number) {
  return { response: { status } }
}

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  // Reset the URL between tests so a `?sid=`/`?sp=` pushed by one test (Copy-link / return-target /
  // space-resolution cases) cannot leak into the next, which reads the link's `?sp=` (standaloneLinkSpace).
  window.history.pushState({}, '', '/')
  wk = createMockWKApp()
  setWKApp(wk)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
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
    // No "back to all documents" link: a standalone /d/:docId share page is a self-contained
    // surface with no resident list to return to, so every terminal drops Back (XIN-505). No
    // Request access either — that is scoped to the forbidden landing.
    expect(screen.queryByText(/docs\.list\.back/)).toBeNull()
    expect(screen.queryByText('docs.forward.requestAccess')).toBeNull()
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

  it('XIN-490 gap2: the 403 forbidden landing offers "Request access" in place', async () => {
    // The whole point of the forward + access-request flow is that a link recipient WITHOUT
    // permission can ask for it. The standalone /d/:docId deep link is the surface most recipients
    // arrive through, yet it used to dead-end on a bare terminal (Back only). It must now render the
    // in-shell RequestAccessButton so the receiver can request access without leaving the page.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_forbidden') throw apiError(403)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_forbidden" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.forbidden')).toBeTruthy(),
    )
    // The reused RequestAccessButton (its hint + action) is present on the forbidden landing.
    expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy()
    // XIN-505 redesign: the landing shows a non-misleading heading instead of a fake "Untitled
    // document" title, and offers no "back to all documents" link (a share page has no list to
    // return to). The reason line is still shown.
    expect(screen.getByText('docs.forward.forbiddenTitle')).toBeTruthy()
    expect(screen.queryByText('docs.state.untitled')).toBeNull()
    expect(screen.queryByText(/docs\.list\.back/)).toBeNull()
    // Clicking POSTs the access request for THIS doc (idempotency enforced server-side).
    fireEvent.click(screen.getByText('docs.forward.requestAccess'))
    await waitFor(() =>
      expect(
        wk.apiClient.calls.some(
          (c) => c.method === 'post' && c.url === '/docs/d_forbidden/access-requests',
        ),
      ).toBe(true),
    )
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
    // Request access is scoped to the forbidden landing only — a not-found terminal has no such
    // affordance (there is no document to request access to).
    expect(screen.queryByText('docs.forward.requestAccess')).toBeNull()
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

  it('XIN-408: a GET 401 with an onSessionExpired handler hands off (clears session + reloads) instead of dead-ending on the terminal', async () => {
    // The page only mounts when a token IS present (Layout gate). A 401 here therefore means the
    // loaded session is EXPIRED — the old behavior rendered the "session expired" terminal with only
    // a Back control and no way to re-authenticate, a dead end. When the host wires onSessionExpired,
    // the page must stash the return target and delegate to it (the host clears the dead session and
    // reloads into the real login screen) rather than rendering the terminal.
    const onSessionExpired = vi.fn()
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_expired') throw apiError(401)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_expired" onSessionExpired={onSessionExpired} />)

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1))
    // The deep-link target is stashed so the post-login flow can bounce the user back to the doc.
    expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).not.toBeNull()
    // No dead-end terminal, no editor: the host is navigating to the login screen.
    expect(screen.queryByText('docs.error.permission.login')).toBeNull()
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

  it('mounts the editor with Copy link pinned as the first ≡ menu row (no resident button, no "Open in App")', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_ok')

    // XIN-416 (boss real-device acceptance): the standalone editor view no longer shows a
    // "← 全部文档" return link. A standalone `/d/:docId` share page is a pure, self-contained
    // surface with no "back to all documents" entry, so the page passes NO onBack to the shared
    // EditorShell and the header renders no back control. (In-shell EditorShell, which still gets
    // onBack from DocsHome, is unaffected — verified separately in EditorShell.test.tsx.)
    expect(screen.queryByTestId('editor-back')).toBeNull()

    // AC-2: Copy link is collapsed into the header ≡ "more" menu as its first (top) row — the
    // page injects it via EditorShell's moreMenuLeadItems, not a resident title-bar button.
    const lead = screen.getByTestId('editor-more-lead')
    const rows = lead.querySelectorAll('button')
    expect(rows.length).toBe(1)
    expect(rows[0].getAttribute('data-testid')).toBe('lead-copy-link')
    expect(rows[0].textContent).toContain('docs.standalone.copyLink')

    // AC-1: no resident "Copy link" button remains in the standalone chrome.
    expect(screen.queryByText('docs.standalone.copyLink', { selector: '.octo-doc-copy-link' })).toBeNull()
    // The reverse "Open in App" exit was removed (boss change): standalone links are opened from
    // an external chat, not from inside the shell, so there is nothing to return to.
    expect(lead.textContent).not.toContain('docs.standalone.openInApp')
  })

  it('AC-3: clicking the Copy link menu row copies the CANONICAL /d/:docId link, stripping ?sid', async () => {
    // Copy-link must NOT leak the sharer's session: the live URL can carry `?sid=` (added when the
    // doc is opened in a new page / returned to post-login). The copied value is the clean canonical
    // link (origin + pathname), with the whole query stripped, so a shared link never carries the
    // sharer's sid.
    window.history.pushState({}, '', '/d/d_ok?sid=sharer-secret')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('lead-copy-link')).toBeTruthy())
    fireEvent.click(screen.getByTestId('lead-copy-link'))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toBe(`${window.location.origin}/d/d_ok`)
    // The sharer's sid never rides along on the shared link.
    expect(copied).not.toContain('sid')
    expect(copied).not.toContain('?')
  })

  it('XIN-513: Copy link keeps the doc space `?sp` but strips the session `?sid`', async () => {
    // The standalone page was opened from a share link carrying `?sp=` (the doc's real space, XIN-501)
    // and the live URL may also carry the sharer's own `?sid=`. The copied canonical link must
    // preserve `?sp` — the next recipient's preflight needs it to address the doc's space — while
    // dropping the session-scoped `?sid`.
    window.history.pushState({}, '', '/d/d_ok?sid=sharer-secret&sp=105d4a60d0fc4d55a5cfc3c2d0501361')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('lead-copy-link')).toBeTruthy())
    fireEvent.click(screen.getByTestId('lead-copy-link'))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toBe(`${window.location.origin}/d/d_ok?sp=105d4a60d0fc4d55a5cfc3c2d0501361`)
    expect(copied).not.toContain('sid')
  })

  it('AC-6: after copying, a menu-external "Link copied" toast appears (visible even though the menu row closes)', async () => {
    // Reviewer's blocker (XIN-386): the old in-row "Link copied" label was dead — selecting the row
    // closes the ≡ menu, so the panel that hosted the label unmounts and the user never sees it.
    // The fix moves the confirmation to a page-level, menu-external toast. This test locks that in:
    // the toast is rendered OUTSIDE the (here-mocked) EditorShell/menu, and it never rode on the row.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('lead-copy-link')).toBeTruthy())
    // No toast before the action.
    expect(screen.queryByText('docs.standalone.linkCopied')).toBeNull()

    fireEvent.click(screen.getByTestId('lead-copy-link'))

    // The toast becomes visible after the copy resolves — proving the confirmation survives the
    // menu closing (the menu row itself is mocked away here, yet the toast still shows).
    const toast = await screen.findByText('docs.standalone.linkCopied')
    expect(toast).toBeTruthy()
    expect(toast.getAttribute('role')).toBe('status')
    // The toast is document-external / menu-external: it is NOT inside the ≡ menu lead-row subtree.
    expect(screen.getByTestId('editor-more-lead').contains(toast)).toBe(false)

    // The dead in-row "copied" label is gone: the menu row label stays the action name, never flips.
    expect(screen.getByTestId('lead-copy-link').textContent).toContain('docs.standalone.copyLink')
    expect(screen.getByTestId('lead-copy-link').textContent).not.toContain('docs.standalone.linkCopied')
  })
})

// Cross-node board-kind (XIN-530, boss real-device): a board created on node A and opened via a
// shared `/d/:docId` link on node B (a FRESH session — the board-kind localStorage registry is
// empty there) must render as a BOARD, not a rich-text document. The standalone page has no local
// registry to lean on, so kind can only come from the AUTHORITATIVE backend `docType` the preflight
// (GET /api/v1/docs/{id}) already carries. Before the fix the page ignored that field and always
// mounted EditorShell, so every cross-node board opened as a document.
describe('StandaloneDocPage — board-kind resolved from authoritative docType (XIN-530)', () => {
  it('opens the whiteboard when the preflight docType is board (empty local registry, cross-node)', async () => {
    // Fresh session: no board-kind registry record for this docId (node B never saw it). The only
    // signal is the backend docType from the preflight — it must drive the shell choice.
    expect(window.localStorage.getItem('octo.board.ids.')).toBeNull()

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/b_shared') {
        return {
          data: { docId: 'b_shared', title: 'Shared Board', ownerId: 'u_owner', docType: 'board' },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="b_shared" />)

    // The whiteboard session mounts — NOT the rich-text editor.
    await waitFor(() => expect(screen.getByTestId('board-session')).toBeTruthy())
    expect(screen.getByTestId('board-doc').textContent).toBe('b_shared')
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('still opens the rich-text editor when the preflight docType is doc (or absent)', async () => {
    // Regression guard: a plain document (or a legacy backend that omits docType) must keep opening
    // in the Tiptap editor — the board branch must not swallow the default doc path.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_plain') {
        return { data: { docId: 'd_plain', title: 'Plain Doc', ownerId: 'u_owner', docType: 'doc' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_plain" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-doc').textContent).toBe('d_plain')
    expect(screen.queryByTestId('board-session')).toBeNull()
  })

  it('addresses the board to the authoritative whiteboard space/folder/board from the preflight documentName (non-default folder)', async () => {
    // XIN-634 P1-a: a board that lives in a NON-default folder. The preflight documentName is the
    // authoritative whiteboard key octo:{space}:{folder}:wb:{board}; the addressing memo must honor
    // parsed.space/folder/board symmetrically with the document branch. Before the fix a whiteboard
    // key fell through to { space: preflightSpace, folder: DEFAULT_DOC_FOLDER, board: docId }, so the
    // standalone share link derived a DIFFERENT room than the REST preflight authorized (wrong collab
    // token / WS room / uid-scoped cache) for any board outside the default folder.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/b_infolder') {
        return {
          data: {
            docId: 'b_infolder',
            title: 'Board In Folder',
            ownerId: 'u_owner',
            docType: 'board',
            documentName: 'octo:s_auth:f_team:wb:board_xyz',
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="b_infolder" />)

    await waitFor(() => expect(screen.getByTestId('board-session')).toBeTruthy())
    // Board segment comes from parsed.board, NOT the URL docId; folder/space from the parsed key.
    expect(screen.getByTestId('board-doc').textContent).toBe('board_xyz')
    expect(screen.getByTestId('board-folder').textContent).toBe('f_team')
    expect(screen.getByTestId('board-folder').textContent).not.toBe('f_default')
    expect(screen.getByTestId('board-space').textContent).toBe('s_auth')
  })
})

describe('standaloneFallbackSpace — cold-start cross-space addressing (blocker 3)', () => {
  it('prefers the live currentSpaceId when the shell has one', () => {
    window.localStorage.setItem('currentSpaceId', 's_cached')
    expect(standaloneFallbackSpace('s_live')).toBe('s_live')
  })

  it('falls back to the cached localStorage currentSpaceId when the shell has none', () => {
    // The standalone page mounts via the Layout early-return, BEFORE the shell restores
    // currentSpaceId — so wk.shared.currentSpaceId is empty on a cold cross-space deep link. The
    // cached key is the user's real last space; using it avoids addressing the wrong room.
    window.localStorage.setItem('currentSpaceId', 's_cached')
    expect(standaloneFallbackSpace('')).toBe('s_cached')
    expect(standaloneFallbackSpace(undefined)).toBe('s_cached')
  })

  it('falls back to the deploy default only when neither is available', () => {
    expect(standaloneFallbackSpace('')).toBe('demo') // DEFAULT_DOC_SPACE
  })
})

describe('StandaloneDocPage — cold-start addressing uses the cached space, not the deploy default (blocker 3)', () => {
  it('addresses the EditorShell to the cached currentSpaceId when the preflight carries no documentName', async () => {
    // Repro: 200 preflight WITHOUT documentName + a cached currentSpaceId in localStorage. Before
    // the fix the page addressed DEFAULT_DOC_SPACE ("demo"), mounting the editor against the wrong
    // room. It must instead use the cached space so the shared doc opens in the right space.
    window.localStorage.setItem('currentSpaceId', 's_real')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        // No documentName in the payload → the addressing memo hits the fallback branch.
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(screen.getByTestId('editor-space').textContent).toBe('s_real')
    expect(screen.getByTestId('editor-space').textContent).not.toBe('demo')
  })
})

describe('StandaloneDocPage — cold-start preflight carries X-Space-Id from the cached space (by-space isolation)', () => {
  it('sends GET /docs/:id with header X-Space-Id = cached currentSpaceId even though wk.shared.currentSpaceId is empty', async () => {
    // Root cause: the standalone page mounts via the Layout early-return, BEFORE the app shell
    // restores currentSpaceId, so wk.shared.currentSpaceId is empty and the global spaceIdCallback
    // interceptor injects NO X-Space-Id. The backend's by-space middleware then rejects the bare
    // preflight (400 space_required / 404 space mismatch) and the page shows the not-found terminal.
    // The fix resolves the space from the SAME cached localStorage key the room addressing uses and
    // passes it as an explicit header on the preflight. This asserts the DOCS-SIDE contract (the page
    // puts the resolved space into the preflight config header); the real wire-level forwarding — host
    // APIClient forwarding config.headers to axios, which was the XIN-424 fake-green — is covered by
    // packages/dmworkbase/src/Service/__tests__/APIClient.headers.test.ts.
    window.localStorage.setItem('currentSpaceId', 'space-abc')
    expect(wk.shared.currentSpaceId).toBeFalsy() // shell has not restored the live space yet

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    const preflight = wk.apiClient.calls.find((c) => c.method === 'get' && c.url === '/docs/d_ok')
    expect(preflight).toBeTruthy()
    expect(preflight!.config?.headers?.['X-Space-Id']).toBe('space-abc')
    // Consistency: the room the editor joins uses the same resolved space as the preflight header.
    expect(screen.getByTestId('editor-space').textContent).toBe('space-abc')
  })

  it('seeds the empty live currentSpaceId from the cached value at standalone mount (defense in depth)', async () => {
    // The primary fix is the explicit header, but the page also restores wk.shared.currentSpaceId
    // from the cached key when empty, so any in-shell-shared logic the EditorShell touches sees it.
    window.localStorage.setItem('currentSpaceId', 'space-abc')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(wk.shared.currentSpaceId).toBe('space-abc')
  })

  it('never overwrites a real live currentSpaceId with the cached value', async () => {
    // In-shell (or any mount where the live space is already set) must be unaffected: the guarded
    // restore only fills an EMPTY space, so a real current space is preserved and the preflight
    // header/room follow the live space, not the stale cached one.
    window.localStorage.setItem('currentSpaceId', 'space-cached')
    wk.shared.currentSpaceId = 'space-live'
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(wk.shared.currentSpaceId).toBe('space-live')
    const preflight = wk.apiClient.calls.find((c) => c.method === 'get' && c.url === '/docs/d_ok')
    expect(preflight!.config?.headers?.['X-Space-Id']).toBe('space-live')
    expect(screen.getByTestId('editor-space').textContent).toBe('space-live')
  })
})

describe('XIN-501 — preflight addresses the doc space from the link ?sp, never the token-bucket ?sid', () => {
  it('standaloneLinkSpace reads the dedicated ?sp param (the doc space), NOT ?sid (the token bucket)', () => {
    // ?sp carries the doc's real space_id; ?sid is only the token-bucket key. They are distinct, and
    // the preflight space must come from ?sp — feeding ?sid was the XIN-497 regression.
    window.history.pushState({}, '', '/d/d_x?sid=2b60d3&sp=105d4a60d0fc4d55a5cfc3c2d0501361')
    expect(standaloneLinkSpace()).toBe('105d4a60d0fc4d55a5cfc3c2d0501361')
    // Trimmed.
    window.history.pushState({}, '', '/d/d_x?sp=%20space-doc%20')
    expect(standaloneLinkSpace()).toBe('space-doc')
    // A link with only the token-bucket ?sid (no ?sp) must NOT be treated as a space → empty, so
    // callers fall back to currentSpaceId/cached/default.
    window.history.pushState({}, '', '/d/d_x?sid=2b60d3')
    expect(standaloneLinkSpace()).toBe('')
    // No query at all → empty.
    window.history.pushState({}, '', '/d/d_x')
    expect(standaloneLinkSpace()).toBe('')
  })

  it('own doc (boss regression): preflight addresses the doc space from ?sp → 200, editor mounts', async () => {
    // Scenario B (severest boss repro): the owner opens their OWN doc via a `/d/:docId` link. The
    // link carries the doc's real space as ?sp and the short token key as ?sid. The preflight MUST
    // send X-Space-Id = the ?sp value; sending the ?sid (as XIN-497 did) trips requireDocRole's
    // cross-space 404 gate and 404s the owner's own doc.
    window.history.pushState({}, '', '/d/d_own?sid=2b60d3&sp=105d4a60d0fc4d55a5cfc3c2d0501361')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_own') {
        return {
          data: { docId: 'd_own', title: 'My Doc', ownerId: 'u_self', role: 'admin' },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_own" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    const preflight = wk.apiClient.calls.find((c) => c.method === 'get' && c.url === '/docs/d_own')
    expect(preflight!.config?.headers?.['X-Space-Id']).toBe('105d4a60d0fc4d55a5cfc3c2d0501361')
    // Never the token-bucket sid.
    expect(preflight!.config?.headers?.['X-Space-Id']).not.toBe('2b60d3')
  })

  it('a no-permission recipient whose OWN space differs from the doc: preflight uses ?sp so the backend returns 403 (forbidden + request-access), not a cross-space 404', async () => {
    // Scenario A: logged in, no permission on THIS doc, recipient's own last space (cached
    // currentSpaceId) is a DIFFERENT space. The preflight must address the doc's space from ?sp so
    // the backend evaluates the caller's role in the doc's space and returns 403 — reaching the
    // request-access entry — instead of the cross-space 404 dead-end.
    window.history.pushState({}, '', '/d/d_shared?sid=2b60d3&sp=space-doc')
    window.localStorage.setItem('currentSpaceId', 'space-mine') // recipient's own last space, NOT the doc's

    wk.apiClient.responder = (method, url) => {
      // Real backend: same-space + no role → 403 forbidden; a mismatched space would be 404.
      if (method === 'get' && url === '/docs/d_shared') throw apiError(403)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_shared" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.forbidden')).toBeTruthy(),
    )
    // The preflight addressed the doc's space (from ?sp), NOT the recipient's own cached space.
    const preflight = wk.apiClient.calls.find((c) => c.method === 'get' && c.url === '/docs/d_shared')
    expect(preflight!.config?.headers?.['X-Space-Id']).toBe('space-doc')
    expect(preflight!.config?.headers?.['X-Space-Id']).not.toBe('space-mine')
    // gap2 request-access entry is reached (the whole point of the fix).
    expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy()
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('a genuinely deleted doc still lands on not-found even with a valid ?sp', async () => {
    // With the correct space, a 404 now means the doc is truly gone (status 0), not a cross-space
    // artifact — so not-found is the correct terminal.
    window.history.pushState({}, '', '/d/d_gone?sid=2b60d3&sp=space-doc')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_gone') throw apiError(404)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_gone" />)

    await waitFor(() => expect(screen.getByText('docs.error.permission.notFound')).toBeTruthy())
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('an older link with only ?sid (no ?sp) falls back to the cached currentSpaceId, so the owner opening their own doc still works', async () => {
    // Backward compatibility: links minted before XIN-501 carry only the token-bucket ?sid. The
    // preflight must NOT send that sid as the space; it falls back to the cached currentSpaceId,
    // which is the doc's space whenever the opener is already in it (owner / same-space recipient).
    window.history.pushState({}, '', '/d/d_legacy?sid=2b60d3')
    window.localStorage.setItem('currentSpaceId', 'space-doc') // opener is in the doc's space
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_legacy') {
        return { data: { docId: 'd_legacy', title: 'Legacy', ownerId: 'u_self' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_legacy" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    const preflight = wk.apiClient.calls.find((c) => c.method === 'get' && c.url === '/docs/d_legacy')
    // The cached space is used — never the token-bucket sid.
    expect(preflight!.config?.headers?.['X-Space-Id']).toBe('space-doc')
    expect(preflight!.config?.headers?.['X-Space-Id']).not.toBe('2b60d3')
  })

  it('a real expired/invalid token still 401s → login handoff, unaffected by the space (AC-4)', async () => {
    // The space only steers requireDocRole's cross-space (404) vs role (403) branches; the auth
    // middleware returns 401 for a bad token regardless of X-Space-Id. So a genuine stale token still
    // hands off to onSessionExpired (login re-auth) — the space fix does not swallow real 401s.
    window.history.pushState({}, '', '/d/d_expired?sid=2b60d3&sp=space-doc')
    const onSessionExpired = vi.fn()
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_expired') throw apiError(401)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_expired" onSessionExpired={onSessionExpired} />)

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('docs.error.permission.forbidden')).toBeNull()
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('seeds the empty live currentSpaceId from the link ?sp so follow-up requests match the preflight', async () => {
    window.history.pushState({}, '', '/d/d_ok?sid=2b60d3&sp=space-doc')
    window.localStorage.setItem('currentSpaceId', 'space-mine') // recipient's own; must NOT win over ?sp
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(wk.shared.currentSpaceId).toBe('space-doc')
    const preflight = wk.apiClient.calls.find((c) => c.method === 'get' && c.url === '/docs/d_ok')
    expect(preflight!.config?.headers?.['X-Space-Id']).toBe('space-doc')
  })
})

describe('standalone return target — open-redirect-safe post-login bounce (blocker 4)', () => {
  it('round-trips a safe same-origin /d/:docId target through persist → consume', () => {
    window.history.pushState({}, '', '/d/d_abc?sid=xyz')
    persistStandaloneReturn()
    expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).toBe('/d/d_abc?sid=xyz')
    expect(consumeStandaloneReturn()).toBe('/d/d_abc?sid=xyz')
    // Consumed once — the key is cleared so a later unrelated login can't inherit a stale target.
    expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).toBeNull()
    expect(consumeStandaloneReturn()).toBeNull()
  })

  it('rejects open-redirect payloads and still clears the key', () => {
    const hostile = [
      '//evil.example.com', // scheme-relative → off-origin
      '/\\evil.example.com', // backslash-smuggled → some browsers normalize to //evil
      'https://evil.example.com/d/x', // absolute URL
      'javascript:alert(1)', // script payload
      'd/relative', // not rooted at /
      '', // empty
      '/', // bare root carries no doc target
      // XIN-392 P1-1: control chars smuggled after the first `/`. The old byte-check saw only
      // path[0]/path[1] and missed the `//host` the WHATWG URL parser normalizes these into.
      '/\n/evil.example.com', // newline → normalizes to scheme-relative //evil
      '/\t/evil.example.com', // tab → same
      '/\r/evil.example.com', // CR → same
      '/d/\td_abc', // control char even inside an otherwise /d/ path
      // XIN-392 P2-2: same-origin but NOT a standalone doc page — must not be a post-login bounce
      // target (a tampered value can't steer the user to another app page after sign-in).
      '/settings',
      '/oidc/bind',
      '/docs?doc=x',
      '/d', // namespace root, not a concrete /d/:docId
      '/d/', // empty id
      '/d/a:b', // malformed id (parseStandaloneDocId → null)
    ]
    for (const bad of hostile) {
      window.sessionStorage.setItem(STANDALONE_RETURN_KEY, bad)
      expect(consumeStandaloneReturn()).toBeNull()
      // Even a rejected value is cleared, so it can't leak into a subsequent login.
      expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).toBeNull()
    }
  })

  it('accepts a safe same-origin /d/:docId target (with and without a query string)', () => {
    for (const good of ['/d/d_abc', '/d/d_abc/', '/d/DOC-9_x?sid=xyz']) {
      window.sessionStorage.setItem(STANDALONE_RETURN_KEY, good)
      expect(consumeStandaloneReturn()).toBe(good)
    }
  })

  it('AC-11 anonymous entry: the sign-in terminal stashes a safe, consumable return target', async () => {
    window.history.pushState({}, '', '/d/d_locked_out')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_locked_out') throw { response: { status: 401 } }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_locked_out" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.login')).toBeTruthy(),
    )
    // The stashed target is a safe relative path that the post-login flow can bounce back to.
    expect(consumeStandaloneReturn()).toBe('/d/d_locked_out')
  })
})

describe('withReturnSid — carry the current session sid on the post-login /d/:docId reload (XIN-398)', () => {
  it('appends the sid to a sid-less standalone target so the reload hits the sid-keyed bucket', () => {
    // The stashed return target has no ?sid=; carrying the just-authenticated session's own sid
    // lets the reloaded /d/:docId resolve the right session directly instead of relying on the
    // now-strict multi-session recovery (which would loop back to login).
    expect(withReturnSid('/d/d_abc', 'fresh6')).toBe('/d/d_abc?sid=fresh6')
    expect(withReturnSid('/d/d_abc/', 'fresh6')).toBe('/d/d_abc/?sid=fresh6')
  })

  it('leaves a target that already carries a sid untouched (no doubling)', () => {
    expect(withReturnSid('/d/d_abc?sid=already', 'fresh6')).toBe('/d/d_abc?sid=already')
  })

  it('is a no-op when there is no sid to carry (session in the empty-sid bucket)', () => {
    expect(withReturnSid('/d/d_abc', null)).toBe('/d/d_abc')
    expect(withReturnSid('/d/d_abc', undefined)).toBe('/d/d_abc')
    expect(withReturnSid('/d/d_abc', '')).toBe('/d/d_abc')
  })

  it('percent-encodes the sid so it cannot smuggle a second query, path, or host (XIN-392 safety)', () => {
    // A sid can only ever come from our own localStorage keys, but encode defensively regardless:
    // the value must land as a single, inert query parameter, never a new path/host/query segment.
    expect(withReturnSid('/d/d_abc', 'a&foo=bar')).toBe('/d/d_abc?sid=a%26foo%3Dbar')
    expect(withReturnSid('/d/d_abc', 'x#frag')).toBe('/d/d_abc?sid=x%23frag')
    expect(withReturnSid('/d/d_abc', '/evil')).toBe('/d/d_abc?sid=%2Fevil')
    // The pathname is unchanged, so the result still resolves to the same /d/:docId and stays safe.
    for (const sid of ['a&foo=bar', 'x#frag', '/evil']) {
      const out = withReturnSid('/d/d_abc', sid)
      expect(parseStandaloneDocId(new URL(out, window.location.origin).pathname)).toBe('d_abc')
    }
  })

  it('preserves the XIN-392 gates end to end: consume → withReturnSid stays a safe /d/:docId link', () => {
    window.sessionStorage.setItem(STANDALONE_RETURN_KEY, '/d/d_deep')
    const consumed = consumeStandaloneReturn()
    expect(consumed).toBe('/d/d_deep')
    const target = withReturnSid(consumed!, 'sid42')
    expect(target).toBe('/d/d_deep?sid=sid42')
    // Re-stashing the sid-bearing target still passes every consume-side gate.
    window.sessionStorage.setItem(STANDALONE_RETURN_KEY, target)
    expect(consumeStandaloneReturn()).toBe('/d/d_deep?sid=sid42')
  })
})

describe('StandaloneDocPage — creator name is nickname-only on the shared surface (blocker 5)', () => {
  it('tells the EditorShell to resolve the creator from the nickname, never the verified real name', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok') {
        return { data: { docId: 'd_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    // The standalone page is an externally shareable surface: it must NOT expose the creator's
    // verified real_name to a link holder. It flags the shell to use the nickname only.
    expect(screen.getByTestId('editor-creator-nickname-only').textContent).toBe('true')
  })
})
