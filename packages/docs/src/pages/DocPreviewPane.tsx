import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { getWKApp, t } from '../octoweb/index.ts'
import { EditorShell } from '../editor/EditorShell.tsx'
import { SheetView } from '../sheet/SheetView.tsx'
import { BoardSession } from '../board/BoardSession.tsx'
import { HtmlDocView } from '../html/HtmlDocView.tsx'
import { DocTerminal, type TerminalKind } from '../editor/DocTerminal.tsx'
import { RequestAccessButton } from '../access-request/RequestAccessButton.tsx'
import { OpenNewPageIcon } from '../editor/DocMoreMenu.tsx'
import { terminalForCreateError } from '../collab/useCollabEditor.ts'
import { getDoc, recordDocView, type DocMeta } from './docsApi.ts'
import { parseDocumentName } from '../documentName/index.ts'
import { DEFAULT_DOC_FOLDER } from '../config.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import '../editor/styles.css'
import './DocPreviewPane.css'

/**
 * In-chat sidebar document pane (WS-17). Renders the SAME collaborative editor the full-page
 * standalone view uses (EditorShell / SheetView / BoardSession — parity with StandaloneDocPage),
 * so a `/d/:docId` link clicked inside chat opens the live document inline for preview + edit +
 * comment WITHOUT leaving the conversation, instead of opening a new browser page.
 *
 * The host (dmworkbase ChatContentPage) mounts this via the `chatDocPreviewPane` endpoint and owns
 * the panel shell (the reused `wk-thread-panel` right-side slot). This component adds a slim top bar
 * with the two sidebar affordances above the reused editor, in EVERY state (loading / terminal /
 * sheet / board / html / document):
 *   - 展开为整页 (onExpandFullPage): the host opens the standalone `/d/:docId?sp=` route in a new tab.
 *   - 关闭 (onClose): the host closes the sidebar slot.
 * The bar is host-owned (not injected into EditorShell's header), so close stays reachable even when
 * the inner editor is on its terminal / loading path and renders no header.
 *
 * Entry is role-driven (writer/admin edit, reader read-only), exactly like the standalone page: the
 * collab token resolves the role and EditorShell renders editable or read-only accordingly, and the
 * preflight GET /docs/{docId} gates the boundary states (forbidden → request access, not-found,
 * archived/locked, expired session) so a permissionless click degrades gracefully, never white-screens.
 */
export interface DocPreviewPaneProps {
  docId: string
  /** The document's own space (`?sp=` from the share link) used to address the preflight + room. */
  space: string
  /** Close the sidebar slot (host-owned). */
  onClose: () => void
  /** Open the standalone full page in a new tab (host-owned; carries `/d/:docId?sp=`). */
  onExpandFullPage: () => void
}

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; meta: DocMeta }
  | { status: 'terminal'; kind: TerminalKind }

/** ✕ close glyph, matching the line-icon style used across the docs header. */
function CloseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  )
}

export function DocPreviewPane({ docId, space, onClose, onExpandFullPage }: DocPreviewPaneProps): ReactElement {
  const wk = getWKApp()
  const uid = wk.loginInfo?.uid ?? ''
  const [phase, setPhase] = useState<Phase>({ status: 'loading' })

  // Preflight the doc BEFORE mounting the collaborative editor — the single deterministic gate for
  // every boundary state (200 → editor; 403/404/401/409 → terminal), mirroring StandaloneDocPage.
  useEffect(() => {
    let cancelled = false
    if (!docId) {
      setPhase({ status: 'terminal', kind: 'not-found' })
      return
    }
    setPhase({ status: 'loading' })
    getDoc(docId, { spaceId: space })
      .then((meta) => {
        if (!cancelled) setPhase({ status: 'ready', meta })
      })
      .catch((err: unknown) => {
        if (!cancelled) setPhase({ status: 'terminal', kind: terminalForCreateError(err) })
      })
    return () => {
      cancelled = true
    }
  }, [docId, space])

  // Log the "最近查看" view ingest once the doc is READY (parity with StandaloneDocPage and the
  // in-shell DocsHome.commitOpen entry — WS-17 review P1-2). Gate on the RESOLVED meta id, not just
  // phase.status: in the sidebar this pane instance is reused across doc switches (no per-doc remount),
  // so on an A→B switch `phase` can still hold A's `ready` meta while `docId` is already B. Keying on
  // `phase.meta.docId === docId` (DocMeta.docId is the id the backend echoed for the preflight we ran)
  // ensures we only record once B's OWN preflight succeeds — never recording B before it resolves, and
  // never recording a doc that then turns out forbidden / not-found. Ref-deduped so re-renders and
  // strict-mode double-invocation record at most once per doc.
  //
  // We pass NO explicit viewer space: inside the live chat shell the global request interceptor already
  // carries the viewer's real `currentSpaceId` as X-Space-Id, so the view records under the viewer's own
  // space (the XIN-1237 write/read contract) without seeding. Forcing the doc's `?sp=` space here would
  // record under a space the viewer may not be in.
  const recordedDocRef = useRef<string | null>(null)
  const readyDocId = phase.status === 'ready' ? phase.meta.docId : undefined
  useEffect(() => {
    if (!docId || readyDocId !== docId) return
    if (recordedDocRef.current === docId) return
    recordedDocRef.current = docId
    void recordDocView(docId)
  }, [readyDocId, docId])

  // Address the room from the preflight's canonical documentName when available (so a doc in a
  // non-default folder / a whiteboard key resolves correctly), else fall back to the link's space
  // + default folder. Same resolution as StandaloneDocPage.
  const addressing = useMemo(() => {
    if (phase.status === 'ready' && phase.meta.documentName) {
      try {
        const parsed = parseDocumentName(phase.meta.documentName)
        if (parsed.kind === 'document') {
          return { space: parsed.space, folder: parsed.folder, doc: parsed.doc, board: undefined }
        }
        if (parsed.kind === 'whiteboard') {
          return { space: parsed.space, folder: parsed.folder, doc: docId, board: parsed.board }
        }
      } catch {
        // Malformed documentName: fall back to the link space + default folder below.
      }
    }
    return { space, folder: DEFAULT_DOC_FOLDER, doc: docId, board: undefined }
  }, [phase, space, docId])

  const names = useMemberNames(addressing.space)

  // The two sidebar controls, reused both as the editor's injected headerRight (document case) and
  // as the slim top bar (loading / terminal / sheet / board).
  const actions: ReactNode = (
    <div className="octo-doc-sidebar-actions">
      <button
        type="button"
        className="octo-doc-sidebar-btn"
        title={t('docs.sidebar.expandFullPage')}
        aria-label={t('docs.sidebar.expandFullPage')}
        onClick={onExpandFullPage}
      >
        {OpenNewPageIcon}
      </button>
      <button
        type="button"
        className="octo-doc-sidebar-btn"
        title={t('docs.sidebar.close')}
        aria-label={t('docs.sidebar.close')}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  )

  const withBar = (body: ReactNode): ReactElement => (
    <div className="octo-doc-sidebar">
      <div className="octo-doc-sidebar-bar">{actions}</div>
      <div className="octo-doc-sidebar-body">{body}</div>
    </div>
  )

  if (phase.status === 'loading') {
    return withBar(<p className="octo-loading">{t('docs.state.loading')}</p>)
  }

  if (phase.status === 'terminal') {
    if (phase.kind === 'forbidden' && docId) {
      return withBar(
        <div className="octo-standalone-card octo-standalone-forbidden" role="alert">
          <h1 className="octo-standalone-card-title">{t('docs.forward.forbiddenTitle')}</h1>
          <p className="octo-standalone-card-msg">{t('docs.error.permission.forbidden')}</p>
          <RequestAccessButton docId={docId} spaceId={space} />
        </div>,
      )
    }
    return withBar(<DocTerminal title={t('docs.state.untitled')} kind={phase.kind} />)
  }

  const meta = phase.meta
  const editorDocId = meta.docId || docId

  // Read-only HTML doc ('html'): its content lives in octo-doc (not the yjs collab store), so it must
  // render via HtmlDocView, mirroring StandaloneDocPage / DocsHome.buildRightPane. The chat click
  // interceptor is docType-agnostic, so without this branch an html doc opened in the sidebar would
  // fall through to the collab EditorShell — which has no yjs data for it and reports "not found"
  // (WS-17 review P1-1). Pass the octo-doc slug so it addresses the published doc.
  if (meta.docType === 'html') {
    return withBar(
      <HtmlDocView
        key={editorDocId}
        docId={editorDocId}
        slug={meta.octoDocSlug}
        space={addressing.space}
      />,
    )
  }

  if (meta.docType === 'board') {
    const boardId = addressing.board || editorDocId
    return withBar(
      <BoardSession
        key={boardId}
        docId={boardId}
        title={meta.title || t('docs.state.untitled')}
        uid={uid}
        space={addressing.space}
        folder={addressing.folder}
        userName={names.get(uid) || uid}
        onOpenInNewPage={onExpandFullPage}
        creatorNicknameOnly
      />,
    )
  }

  if (meta.docType === 'sheet') {
    return withBar(
      <SheetView
        key={editorDocId}
        docId={editorDocId}
        uid={uid}
        space={addressing.space}
        folder={addressing.folder}
        doc={addressing.doc}
        user={{ id: uid, name: names.get(uid) || uid }}
        onOpenInNewPage={onExpandFullPage}
        creatorNicknameOnly
      />,
    )
  }

  // Document (the WS-17 target case). Route through the slim top bar like every other state rather
  // than injecting the controls into EditorShell's own header: EditorShell renders `headerRight`
  // ONLY on its healthy editor path and skips it on its terminal (forbidden / expired / network) and
  // loading (`!instance`) early-returns — which are reached independently of this pane's own getDoc
  // preflight (e.g. the collab connection fails after preflight passed). Keeping close + 展开 in the
  // host-owned bar guarantees they are always reachable, so the pane can never get stuck open.
  return withBar(
    <EditorShell
      key={editorDocId}
      docId={editorDocId}
      title={meta.title || t('docs.state.untitled')}
      uid={uid}
      space={addressing.space}
      folder={addressing.folder}
      doc={addressing.doc}
      user={{ id: uid, name: names.get(uid) || uid }}
      onOpenInNewPage={onExpandFullPage}
      creatorNicknameOnly
    />,
  )
}
