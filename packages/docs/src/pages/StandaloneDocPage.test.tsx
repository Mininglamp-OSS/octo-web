import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { setWKApp } from "../octoweb/index.ts";
import { createMockWKApp } from "../octoweb/mock.ts";
import type { DocMoreMenuItem } from "../editor/DocMoreMenu.tsx";
import { titleContextStore } from "@octo/base";

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
  useMemberDirectory: () => ({ names: new Map<string, string>(), botUids: new Set<string>() }),
}))

// Replace the collaborative spreadsheet host (Univer + Yjs + Hocuspocus) with a marker so a
// docType:'sheet' open-context lands on SheetView without mounting the heavy grid / opening a WS —
// exactly like the editor + board markers above. Echoes the docId/space it was addressed with.
vi.mock('../sheet/SheetView.tsx', () => ({
  SheetView: (props: { docId: string; space?: string; folder?: string }) => (
    <div data-testid="sheet-view">
      <span data-testid="sheet-doc">{props.docId}</span>
      <span data-testid="sheet-space">{props.space}</span>
      <span data-testid="sheet-folder">{props.folder}</span>
    </div>
  ),
}))

vi.mock('../html/HtmlDocView.tsx', () => ({
  HtmlDocView: (props: { docId: string; space?: string }) => (
    <div data-testid="html-view"><span>{props.docId}</span><span>{props.space}</span></div>
  ),
}))

vi.mock('../ppt/PptDocView.tsx', () => ({
  PptDocView: (props: { docId: string; space?: string }) => (
    <div data-testid="ppt-view"><span>{props.docId}</span><span>{props.space}</span></div>
  ),
}))

import {
  StandaloneDocPage,
  forbiddenTitleFrom,
  parseStandaloneDocId,
  isStandaloneDocPath,
  viewerCurrentSpace,
  stripSpFromUrl,
  persistStandaloneReturn,
  consumeStandaloneReturn,
  withReturnSid,
  resolveSameOriginPath,
  STANDALONE_RETURN_KEY,
} from './StandaloneDocPage.tsx'

/** Axios-style rejection shape the docs error handlers read (`err.response.status`). */
function apiError(status: number, data?: unknown) {
  return { response: { status, ...(data === undefined ? {} : { data }) } }
}

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  titleContextStore.clear("docs");
  window.sessionStorage.clear();
  window.localStorage.clear();
  // Reset the URL between tests so a `?sid=`/`?sp=` pushed by one test (Copy-link / return-target /
  // legacy-link cleanup cases) cannot leak into the next.
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
      if (method === 'get' && url === '/docs/d_locked/open-context') throw apiError(409)
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
      if (method === 'get' && url === '/docs/d_forbidden/open-context') throw apiError(403)
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
    window.localStorage.setItem('currentSpaceId', 's_viewer')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_forbidden/open-context') throw apiError(403)
      // The owned-Bot lookup must return a LEGAL empty list: this case asserts the requester can ask
      // for access, which is orthogonal to the Bot dimension. The catch-all `{}` reaches the strict
      // loader as a malformed body and blocks submission, which would test the wrong thing.
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_forbidden" />)

    await waitFor(() =>
      expect(screen.getByText('docs.error.permission.forbidden')).toBeTruthy(),
    )
    // The reused RequestAccessButton (its hint + action) is present on the forbidden landing. Awaited
    // because the button now resolves the owned-Bot lookup before it can offer the action.
    await waitFor(() => expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy())
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
    const post = wk.apiClient.calls.find(
      (c) => c.method === 'post' && c.url === '/docs/d_forbidden/access-requests',
    )!
    expect(post.body).toBeUndefined()
    expect(post.config?.headers?.['X-Space-Id']).toBeUndefined()
    expect(wk.apiClient.calls.some((c) => c.url.startsWith('/robot/owned_bots'))).toBe(false)
  })

  it('keeps a first-time cross-Space access request human-only with no viewer-space lookup/header', async () => {
    wk.shared.currentSpaceId = 's_viewer'
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_cross/open-context') throw apiError(403)
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_cross" />)
    fireEvent.click(await screen.findByText('docs.forward.requestAccess'))
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d_cross/access-requests')).toBe(true))

    const post = wk.apiClient.calls.find((c) => c.url === '/docs/d_cross/access-requests')!
    expect(post.body).toBeUndefined()
    expect(post.config?.headers?.['X-Space-Id']).toBeUndefined()
    expect(wk.apiClient.calls.some((c) => c.url.startsWith('/robot/owned_bots'))).toBe(false)
  })

  // Naming the document on the no-access landing (product decision, leader). Asking someone to
  // 申请访问 a document the page will not name is a dead end: the viewer cannot tell WHICH document
  // they are requesting, and the chat share card already showed them the title before they clicked.
  // The backend discloses the title in the 403 body of the open-context preflight. Be accurate about
  // the bound: open-context locates by docId ALONE and has NO same-space gate, so a 403 can reach a
  // caller from any Space or none — what bounds it is holding the docId plus having already learned
  // the doc exists from getting 403 rather than 404.
  describe('forbidden landing — the document name', () => {
    const forbiddenWith = (data?: unknown) => {
      wk.apiClient.responder = (method, url) => {
        if (method === 'get' && url === '/docs/d_forbidden/open-context') throw apiError(403, data)
        if (method === 'get' && url.startsWith('/robot/owned_bots')) return { data: [], status: 200 }
        return { data: {}, status: 200 }
      }
      render(<StandaloneDocPage docId="d_forbidden" />)
      return waitFor(() =>
        expect(screen.getByText('docs.error.permission.forbidden')).toBeTruthy(),
      )
    }

    it('shows the title the 403 disclosed', async () => {
      await forbiddenWith({ error: 'forbidden', title: 'Q3 规划' })

      const name = await screen.findByText('Q3 规划')
      expect(name).toBeTruthy()
      // Full text on hover, and the heading still leads — the name identifies which document, the
      // heading says what happened.
      expect(name.getAttribute('title')).toBe('Q3 规划')
      expect(screen.getByText('docs.forward.forbiddenTitle')).toBeTruthy()
    })

    it('renders exactly as before when the body carries no title', async () => {
      // A backend that predates the disclosure. The page must degrade to its previous form, NOT
      // substitute a placeholder: the original screen omitted the title precisely to avoid showing a
      // fake 无标题 as though it were the document's name.
      await forbiddenWith({ error: 'forbidden' })

      expect(screen.getByText('docs.forward.forbiddenTitle')).toBeTruthy()
      expect(screen.queryByText('docs.state.untitled')).toBeNull()
      expect(document.querySelector('.octo-standalone-forbidden-doc')).toBeNull()
      // The request-access path still works without a name.
      await waitFor(() => expect(screen.getByText('docs.forward.requestAccess')).toBeTruthy())
    })

    it.each([
      ['a blank title', { error: 'forbidden', title: '   ' }],
      ['a non-string title', { error: 'forbidden', title: 42 }],
      ['a null body', null],
    ])('renders no name line for %s', async (_label, data) => {
      // An error body is untrusted input; anything that is not a non-empty string must not reach the
      // DOM as the document's name.
      await forbiddenWith(data)

      expect(document.querySelector('.octo-standalone-forbidden-doc')).toBeNull()
      expect(screen.getByText('docs.forward.forbiddenTitle')).toBeTruthy()
    })

    // The status gate lives in forbiddenTitleFrom and is tested there, NOT here: a 404 renders
    // DocTerminal, which never reads phase.title, so a page-level "404 shows no name" assertion
    // passes with the gate deleted and would pin nothing. Kept as a page-level smoke check that the
    // not-found terminal is unchanged, with the real gate assertion in the unit block below.
    it('leaves the not-found terminal untouched', async () => {
      wk.apiClient.responder = (method, url) => {
        if (method === 'get' && url === '/docs/d_missing') {
          throw apiError(404, { error: 'not_found', title: 'Leaked Title' })
        }
        return { data: {}, status: 200 }
      }

      render(<StandaloneDocPage docId="d_missing" />)

      await waitFor(() =>
        expect(screen.getByText('docs.error.permission.notFound')).toBeTruthy(),
      )
      expect(screen.queryByText('Leaked Title')).toBeNull()
      expect(document.querySelector('.octo-standalone-forbidden-doc')).toBeNull()
    })

    it('keeps a pathological title inside the card instead of stretching it', async () => {
      // Titles are capped at 512 chars server-side. Display is bounded by CSS (2-line clamp +
      // overflow-wrap), so the full string is kept for the tooltip — assert it is not silently cut,
      // since a truncated tooltip would be worse than none.
      const long = '长'.repeat(400)
      await forbiddenWith({ error: 'forbidden', title: long })

      const name = document.querySelector('.octo-standalone-forbidden-doc')
      expect(name).not.toBeNull()
      expect(name!.getAttribute('title')).toBe(long)
    })

    // The status gate, held at the function level because the page cannot observe it (see the
    // exported helper's comment). A title must be readable ONLY from a 403: the 404 is the response
    // that makes a doc outside the caller's space indistinguishable from one that does not exist, so
    // reading a title off it would leak straight across that boundary.
    describe('forbiddenTitleFrom', () => {
      it('reads the title from a 403', () => {
        expect(forbiddenTitleFrom({ response: { status: 403, data: { title: 'Q3 规划' } } })).toBe(
          'Q3 规划',
        )
      })

      it.each([404, 401, 409, 423, 500])('refuses to read a title from a %i', (status) => {
        expect(
          forbiddenTitleFrom({ response: { status, data: { title: 'Leaked Title' } } }),
        ).toBeUndefined()
      })

      it.each([
        ['blank', '   '],
        ['empty', ''],
      ])('treats a %s title as absent', (_label, title) => {
        expect(forbiddenTitleFrom({ response: { status: 403, data: { title } } })).toBeUndefined()
      })

      it.each([
        ['a number', 42],
        ['an object', { nested: 'x' }],
        ['an array', ['x']],
        ['null', null],
        ['a boolean', true],
      ])('rejects %s as a title — an error body is untrusted input', (_label, title) => {
        expect(forbiddenTitleFrom({ response: { status: 403, data: { title } } })).toBeUndefined()
      })

      it.each([
        ['no data', { response: { status: 403 } }],
        ['no response', {}],
        ['null', null],
        ['undefined', undefined],
        ['a string', 'boom'],
      ])('returns undefined for %s instead of throwing', (_label, err) => {
        expect(() => forbiddenTitleFrom(err)).not.toThrow()
        expect(forbiddenTitleFrom(err)).toBeUndefined()
      })

      it('trims surrounding whitespace but keeps the title intact', () => {
        const long = '长'.repeat(400)
        expect(
          forbiddenTitleFrom({ response: { status: 403, data: { title: `  ${long}  ` } } }),
        ).toBe(long)
      })
    })
  })

  it('AC-10: a GET 404 renders the not-found terminal, editor not mounted', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_missing/open-context') throw apiError(404)
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
      if (method === 'get' && url === '/docs/d_locked_out/open-context') throw apiError(401)
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
      if (method === 'get' && url === '/docs/d_expired/open-context') throw apiError(401)
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
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() =>
      expect(screen.getByTestId("editor-shell")).toBeTruthy()
    );
    await waitFor(() =>
      expect(titleContextStore.get("docs")).toEqual({
        primaryTitle: "Shared Doc",
        moduleTitle: "docs.menu.title",
      })
    );
    expect(screen.getByTestId("editor-doc").textContent).toBe("d_ok");

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

  it('falls back to the module title when the document title is empty', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_untitled/open-context') {
        return { data: { docId: 'd_untitled', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_untitled', title: '   ', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_untitled" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    expect(titleContextStore.get('docs')).toBeUndefined()
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
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
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

  it('Phase-1: Copy link drops BOTH the session `?sid` and a legacy doc-space `?sp`', async () => {
    // The standalone page may be reached from a legacy link carrying `?sp=` (the doc's old space)
    // and the live URL may also carry the sharer's own `?sid=`. The Phase-1 canonical link is the
    // bare `/d/:docId` (design §5.3): the reader resolves the doc's Space server-side from the docId,
    // so the copied link must drop `?sp` as well as the session-scoped `?sid`.
    window.history.pushState({}, '', '/d/d_ok?sid=sharer-secret&sp=105d4a60d0fc4d55a5cfc3c2d0501361')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('lead-copy-link')).toBeTruthy())
    fireEvent.click(screen.getByTestId('lead-copy-link'))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toBe(`${window.location.origin}/d/d_ok`)
    expect(copied).not.toContain('sid')
    expect(copied).not.toContain('sp')
    expect(copied).not.toContain('?')
  })

  it('AC-6: after copying, a menu-external "Link copied" toast appears (visible even though the menu row closes)', async () => {
    // Reviewer's blocker (XIN-386): the old in-row "Link copied" label was dead — selecting the row
    // closes the ≡ menu, so the panel that hosted the label unmounts and the user never sees it.
    // The fix moves the confirmation to a page-level, menu-external toast. This test locks that in:
    // the toast is rendered OUTSIDE the (here-mocked) EditorShell/menu, and it never rode on the row.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
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
      if (method === 'get' && url === '/docs/b_shared/open-context') {
        return {
          data: { docId: 'b_shared', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:wb:b_shared', title: 'Shared Board', ownerId: 'u_owner', docType: 'board' },
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
      if (method === 'get' && url === '/docs/d_plain/open-context') {
        return { data: { docId: 'd_plain', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_plain', title: 'Plain Doc', ownerId: 'u_owner', docType: 'doc' }, status: 200 }
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
      if (method === 'get' && url === '/docs/b_infolder/open-context') {
        return {
          data: {
            docId: 'b_infolder',
            homeSpaceId: 's_auth',
            title: 'Board In Folder',
            ownerId: 'u_owner',
            docType: 'board',
            documentName: 'octo:s_auth:f_team:wb:b_infolder',
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="b_infolder" />)

    await waitFor(() => expect(screen.getByTestId('board-session')).toBeTruthy())
    // Backend invariant: canonical wb segment equals docId.
    expect(screen.getByTestId('board-doc').textContent).toBe('b_infolder')
    expect(screen.getByTestId('board-folder').textContent).toBe('f_team')
    expect(screen.getByTestId('board-folder').textContent).not.toBe('f_default')
    expect(screen.getByTestId('board-space').textContent).toBe('s_auth')
  })
})

describe('viewerCurrentSpace — the space a recorded view is written to (XIN-1237, no deploy-default tail)', () => {
  it('prefers the live currentSpaceId when the shell has one', () => {
    window.localStorage.setItem('currentSpaceId', 's_cached')
    expect(viewerCurrentSpace('s_live')).toBe('s_live')
  })

  it('falls back to the cached localStorage currentSpaceId when the shell has none', () => {
    window.localStorage.setItem('currentSpaceId', 's_cached')
    expect(viewerCurrentSpace('')).toBe('s_cached')
    expect(viewerCurrentSpace(undefined)).toBe('s_cached')
  })

  it('returns empty (NOT the deploy default) when there is no viewer signal, so the caller omits the header', () => {
    // The view record must never be written to a space we cannot confirm the viewer is in, so with
    // no live and no cached signal we return '' and the caller omits the explicit X-Space-Id.
    expect(viewerCurrentSpace('')).toBe('')
    expect(viewerCurrentSpace(undefined)).toBe('')
  })
})

describe('StandaloneDocPage — addresses the editor from the open-context, never a client-guessed space (design §5.2)', () => {
  it('fails closed when the open-context carries no canonical documentName', async () => {
    // Canonical addressing is mandatory. A partial 200 must not fall back to a cached client Space,
    // the deploy default, or homeSpaceId plus a guessed folder.
    window.localStorage.setItem('currentSpaceId', 's_viewer') // a DIFFERENT viewer space; must NOT win
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', title: 'Shared Doc' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByText('docs.error.permission.notFound')).toBeTruthy())
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })

  it('sends the open-context preflight with NO X-Space-Id — docId is the sole locator (design §4/§8.3)', async () => {
    // Phase-1: a wrong/stale `?sp` on an old link must never steer resolution, so the preflight
    // carries no space header at all. The backend resolves the doc from the docId path alone.
    window.history.pushState({}, '', '/d/d_ok?sp=space-wrong')
    window.localStorage.setItem('currentSpaceId', 'space-cached')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    const preflight = wk.apiClient.calls.find(
      (c) => c.method === 'get' && c.url === '/docs/d_ok/open-context',
    )
    expect(preflight).toBeTruthy()
    expect(preflight!.config?.headers?.['X-Space-Id']).toBeUndefined()
  })

  it('never mutates the global currentSpaceId — opening an external /d/:docId cannot pollute the shell Space (design §5.2)', async () => {
    // The old flow seeded the doc's link space into wk.shared.currentSpaceId; Phase-1 removed that.
    // A cold deep link (empty live space) must leave currentSpaceId untouched so the shell's
    // Sidebar / list / search / recent stay on the viewer's own Space.
    window.history.pushState({}, '', '/d/d_ok?sp=space-doc')
    expect(wk.shared.currentSpaceId).toBeFalsy()
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    const { unmount } = render(<StandaloneDocPage docId="d_ok" />)
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    // The doc's home space addressed the editor locally, but the global current space was never set.
    expect(wk.shared.currentSpaceId).toBeFalsy()
    unmount()
    expect(wk.shared.currentSpaceId).toBeFalsy()
  })
})

describe('stripSpFromUrl — legacy `?sp` cleanup preserves every other param (design §8.4)', () => {
  it('removes ONLY sp, keeping sid / other query / hash intact', () => {
    window.history.pushState({}, '', '/d/d_ok?sid=abc&sp=space-old&foo=bar#sec2')
    stripSpFromUrl()
    const url = new URL(window.location.href)
    expect(url.searchParams.has('sp')).toBe(false)
    // sid, arbitrary other query, and the hash all survive — each has its own lifecycle (§8.4).
    expect(url.searchParams.get('sid')).toBe('abc')
    expect(url.searchParams.get('foo')).toBe('bar')
    expect(url.hash).toBe('#sec2')
    // The path is untouched.
    expect(url.pathname).toBe('/d/d_ok')
  })

  it('is a no-op when there is no sp (the common new-link case) — URL unchanged', () => {
    window.history.pushState({}, '', '/d/d_ok?sid=abc#sec2')
    const before = window.location.href
    stripSpFromUrl()
    expect(window.location.href).toBe(before)
  })

  it('removes a repeated sp entirely while preserving order of the rest', () => {
    window.history.pushState({}, '', '/d/d_ok?sp=a&keep=1&sp=b')
    stripSpFromUrl()
    const url = new URL(window.location.href)
    expect(url.searchParams.has('sp')).toBe(false)
    expect(url.searchParams.get('keep')).toBe('1')
  })

  it('preserves untouched query bytes, duplicates, blanks, separators, and hash exactly', () => {
    window.history.pushState({}, '', '/d/d_ok?a=%2f&sp=x&a=%2F&&blank=&sp=y#h%20x')
    stripSpFromUrl()
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe('/d/d_ok?a=%2f&a=%2F&&blank=#h%20x')
  })

  it('removes bare and percent-encoded sp keys without re-encoding other params', () => {
    window.history.pushState({}, '', '/d/d_ok?sp&keep=hello+world&%73p=old&x=%7e')
    stripSpFromUrl()
    expect(window.location.search).toBe('?keep=hello+world&x=%7e')
  })
})

describe('StandaloneDocPage — legacy `?sp` link: wrong/correct/missing sp all resolve identically (design §8.2/§8.3)', () => {
  // Same user, same docId. A legacy link may carry a correct `?sp`, a wrong `?sp`, or none at all.
  // open-context locates the doc by docId ALONE, so all three must issue the identical request (no
  // X-Space-Id, same URL) and reach the identical ready state; after opening, `sp` is stripped from
  // the address bar while everything else is preserved.
  const okContext = {
    docId: 'd_ok',
    homeSpaceId: 's_home',
    documentName: 'octo:s_home:f_default:d_ok',
    title: 'Shared Doc',
  }

  async function openWith(search: string) {
    window.history.pushState({}, '', `/d/d_ok${search}`)
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') return { data: okContext, status: 200 }
      return { data: {}, status: 200 }
    }
    render(<StandaloneDocPage docId="d_ok" />)
    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    const preflight = wk.apiClient.calls.find(
      (c) => c.method === 'get' && c.url === '/docs/d_ok/open-context',
    )
    return preflight!
  }

  it('correct sp: opens, sends no X-Space-Id, strips sp from the address bar', async () => {
    const preflight = await openWith('?sp=s_home')
    expect(preflight.config?.headers?.['X-Space-Id']).toBeUndefined()
    // The editor is addressed from the authoritative homeSpaceId, not the link `sp`.
    expect(screen.getByTestId('editor-space').textContent).toBe('s_home')
    expect(new URL(window.location.href).searchParams.has('sp')).toBe(false)
  })

  it('wrong sp: still opens the same doc, sp cannot steer resolution, and is stripped', async () => {
    const preflight = await openWith('?sp=s_totally_wrong')
    expect(preflight.config?.headers?.['X-Space-Id']).toBeUndefined()
    // Wrong link space never leaks into addressing — the backend's homeSpaceId wins.
    expect(screen.getByTestId('editor-space').textContent).toBe('s_home')
    expect(new URL(window.location.href).searchParams.has('sp')).toBe(false)
  })

  it('missing sp (canonical new link): opens identically with no cleanup needed', async () => {
    const preflight = await openWith('')
    expect(preflight.config?.headers?.['X-Space-Id']).toBeUndefined()
    expect(screen.getByTestId('editor-space').textContent).toBe('s_home')
    expect(window.location.search).toBe('')
  })

  it('legacy sp alongside sid: opens, strips sp, and PRESERVES sid for session recovery', async () => {
    await openWith('?sid=keepme&sp=s_wrong')
    const url = new URL(window.location.href)
    expect(url.searchParams.has('sp')).toBe(false)
    expect(url.searchParams.get('sid')).toBe('keepme')
  })
})

describe('StandaloneDocPage — a docType:sheet open-context mounts the collaborative SheetView', () => {
  it('opens the spreadsheet surface addressed from the canonical documentName', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_sheet/open-context') {
        return {
          data: {
            docId: 'd_sheet',
            homeSpaceId: 's_auth',
            title: 'Shared Sheet',
            docType: 'sheet',
            documentName: 'octo:s_auth:f_team:d_sheet',
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_sheet" />)

    await waitFor(() => expect(screen.getByTestId('sheet-view')).toBeTruthy())
    expect(screen.getByTestId('sheet-doc').textContent).toBe('d_sheet')
    // Space/folder come from the authoritative documentName the backend authorized.
    expect(screen.getByTestId('sheet-space').textContent).toBe('s_auth')
    expect(screen.getByTestId('sheet-folder').textContent).toBe('f_team')
    expect(screen.queryByTestId('editor-shell')).toBeNull()
  })
})

describe('StandaloneDocPage — non-Yjs HTML surfaces', () => {
  it.each([
    ['html', 'html-view'],
    ['html_ppt', 'ppt-view'],
  ])('opens standalone %s from canonical addressing without mounting Yjs surfaces', async (docType, testId) => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === `/docs/d_${docType}/open-context`) {
        return {
          data: {
            docId: `d_${docType}`,
            homeSpaceId: 's_home',
            documentName: `octo:s_home:f_default:${docType === 'html' ? 'html' : 'ppt'}:d_${docType}`,
            docType,
            octoDocSlug: `slug-${docType}`,
          },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId={`d_${docType}`} />)

    await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy())
    expect(screen.queryByTestId('editor-shell')).toBeNull()
    expect(screen.queryByTestId('sheet-view')).toBeNull()
    expect(screen.queryByTestId('board-session')).toBeNull()
    expect(wk.apiClient.calls.some((c) => c.url.includes('collab-token'))).toBe(false)
  })
})

describe('resolveSameOriginPath — PPT editorUrl normalise (P2-1)', () => {
  const origin = window.location.origin

  it('normalises a same-origin ABSOLUTE url to a rooted path (the P2-1 accept case)', () => {
    expect(resolveSameOriginPath(`${origin}/ppt/d/abc`)).toBe('/ppt/d/abc')
    // query + hash are preserved.
    expect(resolveSameOriginPath(`${origin}/ppt/d/abc?sp=1#s2`)).toBe('/ppt/d/abc?sp=1#s2')
  })

  it('accepts a rooted-relative path and a bare-relative path (resolved against origin root)', () => {
    expect(resolveSameOriginPath('/ppt/d/abc?sp=1')).toBe('/ppt/d/abc?sp=1')
    // A bare-relative value that isSameOriginPath would REJECT is normalised to a rooted path here.
    expect(resolveSameOriginPath('d/abc')).toBe('/d/abc')
  })

  it('rejects cross-origin / scheme-relative / javascript / control-char / empty values', () => {
    for (const bad of [
      'https://evil.example.com/steal', // cross-origin absolute
      '//evil.example.com', // scheme-relative → off-origin
      'javascript:alert(1)', // script payload (opaque origin)
      '/\n/evil.example.com', // newline smuggles //host past the URL parser
      '/\t/evil.example.com', // tab → same
      '', // empty
    ]) {
      expect(resolveSameOriginPath(bad)).toBeNull()
    }
    expect(resolveSameOriginPath(null)).toBeNull()
    expect(resolveSameOriginPath(undefined)).toBeNull()
  })

  it('collapses leading-slash runs so a normalised path can never be scheme-relative (P1-1)', () => {
    // Each input parses same-origin, but its pathname begins with `//` (or resolves to one via
    // dot-segments / backslash smuggling). Handing that back verbatim lets location.assign()
    // re-parse it as SCHEME-RELATIVE and bounce cross-origin. The guard must return a single-rooted
    // path that stays same-origin when re-parsed.
    const rows = [
      `${origin}//evil.example.com/steal`, // absolute same-origin, pathname `//evil…`
      `${origin}/\\/evil.example.com/steal`, // backslash → `/` in special schemes → `//evil…`
      '/..//evil.example.com/steal', // rooted; `/..` clamps to root, leaving `//evil…`
      '/a/../..//evil.example.com', // rooted; dot-segments collapse to `//evil…`
    ]
    for (const raw of rows) {
      const result = resolveSameOriginPath(raw)
      expect(result).not.toBeNull()
      // Exactly one leading slash — not scheme-relative.
      expect(result!.startsWith('//')).toBe(false)
      expect(result!.startsWith('/')).toBe(true)
      // Re-parsing the returned value (as location.assign would) stays on the current origin.
      expect(new URL(result!, origin).origin).toBe(origin)
    }
  })

  it('rejects non-http(s) same-origin protocols (e.g. blob:) whose pathname is not a real page path', () => {
    // blob:<origin>/… reports a matching origin, but its pathname is the whole inner URL, so it is
    // not a navigable rooted path. Only http/https page schemes are accepted.
    expect(resolveSameOriginPath(`blob:${origin}/550e8400-e29b-41d4-a716-446655440000`)).toBeNull()
  })
})

describe('standalone return target — open-redirect-safe post-login bounce (blocker 4)', () => {
  it('round-trips a safe same-origin /d/:docId target through persist → consume', () => {
    window.history.pushState({}, '', '/d/d_abc?sid=xyz#comment-1')
    persistStandaloneReturn()
    expect(window.sessionStorage.getItem(STANDALONE_RETURN_KEY)).toBe('/d/d_abc?sid=xyz#comment-1')
    expect(consumeStandaloneReturn()).toBe('/d/d_abc?sid=xyz#comment-1')
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

  it('accepts a safe same-origin /s/:taskNo target for summary notification returns', () => {
    for (const good of ['/s/TN_20260713_abcd', '/s/TN-9_x?sp=space-1']) {
      window.sessionStorage.setItem(STANDALONE_RETURN_KEY, good)
      expect(consumeStandaloneReturn()).toBe(good)
    }
  })

  it('AC-11 anonymous entry: the sign-in terminal stashes a safe, consumable return target', async () => {
    window.history.pushState({}, '', '/d/d_locked_out')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_locked_out/open-context') throw { response: { status: 401 } }
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
    expect(withReturnSid('/s/TN_20260713_abcd?sp=space-1', 'fresh6')).toBe('/s/TN_20260713_abcd?sp=space-1&sid=fresh6')
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
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
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

describe('StandaloneDocPage — records a view so share-link opens surface in 最近查看 (XIN-1238)', () => {
  it('fires POST /docs/:id/view once the doc is ready, written to the VIEWER current space, not the doc home space', async () => {
    // XIN-1234 root cause: the standalone page never recorded a view, so a doc opened from a chat
    // share link never appeared in the opener's 最近查看. XIN-1237 write/read space contract: the
    // view must be written under the VIEWER's current space (X-Space-Id), which 最近查看 reads back
    // by — NOT the doc's own home space. Phase-1 no longer seeds the doc space into currentSpaceId
    // (design §5.2), so the viewer space stays the shell's own throughout.
    // Cross-space: a legacy link may still carry `?sp=space-doc` (now ignored), but the viewer is
    // currently in space-viewer (their cached/live current space).
    window.history.pushState({}, '', '/d/d_ok?sp=space-doc')
    window.localStorage.setItem('currentSpaceId', 'space-viewer')

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.method === 'post' && c.url === '/docs/d_ok/view')).toBe(true),
    )
    const view = wk.apiClient.calls.find((c) => c.method === 'post' && c.url === '/docs/d_ok/view')
    // The open-context preflight sends NO space header (docId is the sole locator, design §8.3); the
    // view ingest goes to the viewer's OWN current space so it surfaces in the viewer's recent list.
    const preflight = wk.apiClient.calls.find((c) => c.method === 'get' && c.url === '/docs/d_ok/open-context')
    expect(preflight!.config?.headers?.['X-Space-Id']).toBeUndefined()
    expect(view!.config?.headers?.['X-Space-Id']).toBe('space-viewer')
  })

  it('same-space share (老板 real-device acceptance): opening a doc from a same-space group link records the view under that space so it surfaces in 最近查看', async () => {
    // The acceptance scenario (三叉戟大队): the viewer opens a doc shared in the space they are
    // already in. The link's `?sp=` and the viewer's current space are the SAME space, so the view
    // is recorded under that space and the shell's recent-view read (scoped to the same current
    // space) surfaces it — the exact "点链接开同 space 文档→回→最近查看可见" flow.
    window.history.pushState({}, '', '/d/d_ok?sp=space-team')
    window.localStorage.setItem('currentSpaceId', 'space-team')

    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Team Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.method === 'post' && c.url === '/docs/d_ok/view')).toBe(true),
    )
    const view = wk.apiClient.calls.find((c) => c.method === 'post' && c.url === '/docs/d_ok/view')
    expect(view!.config?.headers?.['X-Space-Id']).toBe('space-team')
  })

  it('per-space safety: with no live and no cached viewer space, the view record omits the explicit X-Space-Id instead of forcing the deploy default', async () => {
    // No viewer signal at all (no live currentSpaceId, no cached one). Recording the view under the
    // deploy-default space would write it into a space the viewer isn't in — polluting that space's
    // recent list and still never surfacing in the viewer's own. Omit the explicit header and let
    // the global interceptor decide, exactly as the in-shell entry does.
    window.history.pushState({}, '', '/d/d_ok?sp=space-doc')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.method === 'post' && c.url === '/docs/d_ok/view')).toBe(true),
    )
    const view = wk.apiClient.calls.find((c) => c.method === 'post' && c.url === '/docs/d_ok/view')
    // No explicit header forced: never the deploy default, never the doc link space.
    expect(view!.config?.headers?.['X-Space-Id']).toBeUndefined()
  })

  it('uses the live current space as the viewer space when the shell already restored it (in-shell mount)', async () => {
    wk.shared.currentSpaceId = 'space-live'
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.method === 'post' && c.url === '/docs/d_ok/view')).toBe(true),
    )
    const view = wk.apiClient.calls.find((c) => c.method === 'post' && c.url === '/docs/d_ok/view')
    expect(view!.config?.headers?.['X-Space-Id']).toBe('space-live')
  })

  it('records the view at most once (idempotent — never in a render loop)', async () => {
    window.localStorage.setItem('currentSpaceId', 'space-viewer')
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_ok/open-context') {
        return { data: { docId: 'd_ok', homeSpaceId: 's_home', documentName: 'octo:s_home:f_default:d_ok', title: 'Shared Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_ok" />)

    await waitFor(() => expect(screen.getByTestId('editor-shell')).toBeTruthy())
    await waitFor(() =>
      expect(wk.apiClient.calls.filter((c) => c.method === 'post' && c.url === '/docs/d_ok/view').length).toBe(1),
    )
    // Give any stray re-render a chance to double-fire, then re-assert the single call.
    await new Promise((r) => setTimeout(r, 0))
    expect(wk.apiClient.calls.filter((c) => c.method === 'post' && c.url === '/docs/d_ok/view').length).toBe(1)
  })

  it('does NOT record a view when the preflight fails to a terminal (forbidden / not-found)', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_forbidden/open-context') {
        return Promise.reject(apiError(403))
      }
      return { data: {}, status: 200 }
    }

    render(<StandaloneDocPage docId="d_forbidden" />)

    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.method === 'get' && c.url === '/docs/d_forbidden/open-context')).toBe(true),
    )
    expect(wk.apiClient.calls.some((c) => c.url === '/docs/d_forbidden/view')).toBe(false)
  })
})
