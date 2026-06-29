import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react'
import { DocTitle } from '../editor/EditorShell.tsx'
import { canManage } from '../auth/roles.ts'
import { useDocDelete } from '../editor/useDocDelete.ts'
import { getDoc } from '../pages/docsApi.ts'
import type { Role } from '../auth/roles.ts'
import { i18n, t } from '../octoweb/index.ts'
import { loadBoardScene, persistBoardScene, clearBoardScene, type BoardScene } from './boardStore.ts'
import type { WhiteboardSession } from './collab/index.ts'
import type { ExcalidrawElement, BinaryFileData } from './collab/index.ts'
import {
  setLocalPresenceUser,
  publishLocalPointer,
  clearLocalPointer,
  readBoardCollaborators,
  type BoardCollaborator,
  type BoardPresenceUser,
} from './collab/presence.ts'
import '../editor/styles.css'
import './board.css'

/**
 * Minimal structural view of the Excalidraw component's props — just the surface BoardShell
 * drives. We deliberately avoid importing Excalidraw's own types at module scope: the library is
 * loaded with a client-only dynamic import (see below), and pulling its types eagerly would also
 * pull a large `.d.ts` graph into the isolated docs typecheck for no benefit here.
 */
type ExcalidrawChange = (
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
) => void
/** Excalidraw's live-pointer callback (scene coords) — drives the local→awareness presence write. */
type ExcalidrawPointerUpdate = (payload: {
  pointer: { x: number; y: number; tool?: string }
  button: 'down' | 'up'
}) => void
interface ExcalidrawProps {
  initialData?: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown>; scrollToContent?: boolean } | null
  onChange?: ExcalidrawChange
  /** Imperative API handle (M2 binding drives remote→updateScene through it). */
  excalidrawAPI?: (api: unknown) => void
  /** Remote peers' cursors + online list (XIN-111 presence). Keyed by awareness client id. */
  collaborators?: Map<string, BoardCollaborator>
  /** Local pointer stream we publish into provider.awareness so peers see this cursor (XIN-111). */
  onPointerUpdate?: ExcalidrawPointerUpdate
  viewModeEnabled?: boolean
  theme?: 'light' | 'dark'
  langCode?: string
  UIOptions?: Record<string, unknown>
}
type ExcalidrawComponent = ComponentType<ExcalidrawProps>

/**
 * Structural view of the two Excalidraw collaboration helpers BoardShell injects into the binding
 * (XIN-87). They are read off the same client-only dynamic import as the component, so the binding
 * stays Yjs-only and Excalidraw's types are never pulled in at module scope.
 *
 * - `restoreElements` rehydrates raw (cross-peer / persisted) elements into renderable shapes —
 *   the step whose absence made remote elements paint as points/handles and reopened boards replay
 *   empty.
 * - `reconcileElements` merges the live local scene with restored remote elements by version.
 */
type RestoreElementsFn = (
  elements: readonly unknown[] | null | undefined,
  localElements: readonly unknown[] | null | undefined,
) => ExcalidrawElement[]
type ReconcileElementsFn = (
  localElements: readonly unknown[],
  remoteElements: readonly unknown[],
  localAppState: unknown,
) => ExcalidrawElement[]

/** Debounce window for persisting scene edits (M1 local persistence). */
const SAVE_DEBOUNCE_MS = 600

export interface BoardShellProps {
  docId: string
  /** Fallback title until the real one is fetched (mirrors EditorShell). */
  title: string
  space: string
  /** Optional "back to the document list" control (inline/standalone path only). */
  onBack?: () => void
  /** Programmatic return-to-list (used after a delete). */
  onExit?: () => void
  /** Called after a successful rename so the resident list refreshes its titles. */
  onTitleSaved?: (docId: string, title: string) => void
  /** Called after a successful delete so the list refreshes and the open board closes. */
  onDeleted?: (docId: string) => void
  /**
   * M2 collaborative session. When supplied, the board binds to the shared Y.Doc: local edits
   * flow through the binding (CAS + anti-loop guards) and remote/agent writes render via
   * `updateScene`. When omitted (M1 standalone / no backend), the board keeps the local-only
   * persistence path below. The caller owns the session lifecycle (create/destroy).
   */
  collabSession?: WhiteboardSession | null
  /**
   * Local peer identity for presence (XIN-111). Published into `collabSession.provider.awareness`
   * so remote peers can label and colour this user's cursor / online avatar. Omitted on the M1
   * standalone path (no session), where presence is inert.
   */
  user?: BoardPresenceUser
}

/** Map the app locale (`zh-CN` / `en-US`) to an Excalidraw langCode (`zh-CN` / `en`). */
function toExcalidrawLang(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** Best-effort theme: follow the OS preference, matching the docs `.octo-theme` media query. */
function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/**
 * Error boundary around the Excalidraw subtree (mirrors DocsErrorBoundary): a render throw in the
 * board canvas surfaces a recoverable message instead of tearing down the host tree.
 */
class BoardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[board] canvas failed', error, info.componentStack)
  }
  render(): ReactNode {
    if (this.state.error) return <div className="octo-board-state octo-error">{t('docs.state.error')}</div>
    return this.props.children
  }
}

/**
 * Whiteboard editor shell (frontend-design §5.1) — the board counterpart of EditorShell, NOT a
 * reuse of the Tiptap shell. It aligns the header with Docs (back / editable title / actions) and
 * embeds Excalidraw in the body.
 *
 * Client-only embed: Excalidraw touches `window`/DOM at import time and cannot render under SSR,
 * so it is loaded with a manual `import()` driven by useState/useEffect — the same pattern
 * DocsHomeRoute uses for the editor chunk, which also sidesteps the host's Suspense-hostile
 * re-render loop. The bundle is therefore code-split and never runs on a server.
 *
 * M1 has no realtime collaboration (binding is M2): the scene persists LOCALLY via boardStore so
 * a board survives close/reopen and a full refresh. `persistBoardScene` is the seam the backend
 * save will hook into in M2.
 */
export function BoardShell(props: BoardShellProps): ReactElement {
  const { docId, title, onBack, onExit, onTitleSaved, onDeleted, collabSession, user } = props

  const [Excalidraw, setExcalidraw] = useState<ExcalidrawComponent | null>(null)
  const [failed, setFailed] = useState(false)
  const [role, setRole] = useState<Role | undefined>(undefined)
  const [dark, setDark] = useState(prefersDark)
  // Remote peers' presence (XIN-111): cursors + online list, rebuilt from provider.awareness on
  // every awareness `change`. Empty on the M1 standalone path (no session).
  const [collaborators, setCollaborators] = useState<Map<string, BoardCollaborator>>(() => new Map())

  // Excalidraw's restore/reconcile helpers, captured off the same dynamic import as the component
  // (XIN-87). Held in refs because they are pure module functions, not render state — they are read
  // by `handleApi` (to wire the binding's render adapter) and by the initialData memo below.
  const restoreElementsRef = useRef<RestoreElementsFn | null>(null)
  const reconcileElementsRef = useRef<ReconcileElementsFn | null>(null)

  // Initial scene is read ONCE, synchronously, from the local mirror so a reopened / refreshed
  // board paints its content on first render (no flash of empty canvas).
  const initialSceneRef = useRef<BoardScene | null>(null)
  if (initialSceneRef.current === null) initialSceneRef.current = loadBoardScene(docId)

  const langCode = toExcalidrawLang(i18n.getLocale ? i18n.getLocale() : 'en-US')

  // Client-only dynamic import of Excalidraw + its stylesheet. Runs once; the chunk is fetched on
  // demand so it never inflates the host's first paint and never executes under SSR.
  useEffect(() => {
    let active = true
    Promise.all([
      import('@excalidraw/excalidraw'),
      // Side-effect stylesheet import — required for the canvas/UI to render correctly.
      import('@excalidraw/excalidraw/index.css'),
    ])
      .then(([mod]) => {
        if (!active) return
        // Capture the collab helpers before the component so the initialData memo and handleApi
        // (both gated on `Excalidraw` becoming non-null) can rely on them being present.
        const m = mod as unknown as {
          restoreElements?: RestoreElementsFn
          reconcileElements?: ReconcileElementsFn
        }
        restoreElementsRef.current = m.restoreElements ?? null
        reconcileElementsRef.current = m.reconcileElements ?? null
        setExcalidraw(() => mod.Excalidraw as unknown as ExcalidrawComponent)
      })
      .catch((err) => {
        console.error('[board] failed to load Excalidraw', err)
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  // Follow OS theme changes live so the canvas re-themes with the rest of the app.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setDark(mq.matches)
    try {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    } catch {
      return undefined
    }
  }, [])

  // Resolve the caller's role for THIS board so a reader gets a read-only canvas. Resilient:
  // leaves role undefined (→ editable) if the meta lacks it; the backend remains the real gate.
  useEffect(() => {
    let cancelled = false
    getDoc(docId)
      .then((meta) => {
        if (!cancelled && meta?.role) setRole(meta.role)
      })
      .catch(() => {
        /* non-fatal: fall back to editable; server still enforces permissions */
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  // Debounced local persistence of scene edits. The timer is cleared on unmount and a final flush
  // is forced so a quick draw-then-close still saves (the close/reopen acceptance path).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestScene = useRef<BoardScene | null>(null)
  const readOnly = role === 'reader'

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (latestScene.current) persistBoardScene(docId, latestScene.current)
  }, [docId])

  const onChange = useCallback<ExcalidrawChange>(
    (elements, appState, files) => {
      if (readOnly) return // never persist from a read-only session
      // M2: when bound to a collab session, route the edit through the binding (diff → CAS →
      // Y.Doc under LOCAL_ORIGIN; the binding's guards stop a remote apply from echoing back).
      if (collabSession) {
        collabSession.binding.handleLocalChange(
          elements as readonly ExcalidrawElement[],
          files as Record<string, BinaryFileData>,
        )
      }
      // Local mirror stays as the offline-first fallback (boardStore §M1↔M2 seam).
      latestScene.current = { elements: [...elements], appState, files }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        if (latestScene.current) persistBoardScene(docId, latestScene.current)
      }, SAVE_DEBOUNCE_MS)
    },
    [docId, readOnly, collabSession],
  )

  // M2: hand the imperative Excalidraw API to the binding so remote/agent writes can render via
  // updateScene, and wire the restore/reconcile contract (XIN-87) so those writes render as real
  // shapes — not raw points/handles. The adapter captures this api for `getAppState()`, which
  // reconcileElements needs. No-op in the M1 standalone path (no session).
  const handleApi = useCallback(
    (api: unknown) => {
      const binding = collabSession?.binding
      if (!binding) return
      binding.setApi(api as Parameters<WhiteboardSession['binding']['setApi']>[0])

      const restore = restoreElementsRef.current
      const reconcile = reconcileElementsRef.current
      if (!restore || !reconcile) return
      const imperative = api as { getAppState?: () => unknown }
      binding.setRenderAdapter({
        restore: (remote) => restore(remote, null),
        reconcile: (local, restoredRemote) =>
          reconcile(local, restoredRemote, imperative.getAppState?.()),
      })
    },
    [collabSession],
  )

  // Presence (XIN-111 / case8 presence_delta=0). The board opened a real HocuspocusProvider for
  // content sync (XIN-55) but never wired presence onto it — the binding's __awareness was a
  // local-only stub that never touched provider.awareness, so A's cursor/online state never
  // reached B (presence_delta stayed 0 while canvas content synced fine). Mirror the doc editor:
  // publish this peer's identity into provider.awareness and rebuild the Excalidraw `collaborators`
  // map from remote peers on every awareness change. Volatile only — never the Y.Doc, so the 0-7
  // content path is untouched.
  useEffect(() => {
    const awareness = collabSession?.provider.awareness
    if (!awareness) return
    if (user) setLocalPresenceUser(awareness, user)
    const update = () => setCollaborators(readBoardCollaborators(awareness))
    update()
    awareness.on('change', update)
    return () => {
      awareness.off('change', update)
      // Drop our cursor so peers stop drawing a stale one once we leave this board.
      clearLocalPointer(awareness)
    }
  }, [collabSession, user])

  // Excalidraw's live pointer (scene coords) → provider.awareness, so remote peers render this
  // cursor. No Y.Doc write; inert when there is no session.
  const onPointerUpdate = useCallback<ExcalidrawPointerUpdate>(
    (payload) => {
      const awareness = collabSession?.provider.awareness
      if (!awareness) return
      publishLocalPointer(awareness, payload.pointer, payload.button)
    },
    [collabSession],
  )

  // Flush any pending save when the board unmounts (switching docs / leaving) and when the tab is
  // hidden/closed, so an edit made just before navigating away is not lost.
  useEffect(() => {
    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
      flush()
    }
  }, [flush])

  // Delete entry (manage role only), consistent with the Docs editor. On success drop the local
  // scene too, then hand control back to the parent (refresh list + close) or fall back to onExit.
  const returnToList = onExit ?? onBack
  const handleDeleted = useCallback(
    (id: string) => {
      clearBoardScene(id)
      if (onDeleted) onDeleted(id)
      else returnToList?.()
    },
    [onDeleted, returnToList],
  )
  const del = useDocDelete(docId, handleDeleted)

  const manage = role ? canManage(role) : false

  // Restore the initially-loaded scene before feeding it to Excalidraw (XIN-87). The local mirror
  // (and, on a cold reopen, the Y.Doc state that seeded it) can hold raw elements; handing those to
  // `initialData` unrestored is why a reopened board replayed empty. Gated on `Excalidraw` so the
  // restore helper (captured in the same import) is present; falls back to raw if unavailable.
  const initialElements = useMemo<unknown[]>(() => {
    let raw = initialSceneRef.current?.elements ?? []
    // Cold reopen (XIN-96): a NEW client's local mirror is empty, but the collab provider has
    // usually synced the existing board into the Y.Doc by the time this heavy Excalidraw chunk
    // finishes loading. Seed initialData from the Y.Doc so the canvas mounts WITH the synced scene
    // — otherwise Excalidraw initialises empty, clobbers the binding's setApi replay, and fires a
    // stale empty onChange, replaying the board empty. (When the doc has not synced yet this is []
    // and the later observe→applyRemote renders it; that ordering already worked.)
    if (raw.length === 0 && collabSession?.binding) {
      const docEls = collabSession.binding.snapshotElements()
      if (docEls.length > 0) raw = docEls
    }
    const restore = restoreElementsRef.current
    return restore ? restore(raw, null) : [...raw]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Excalidraw, collabSession])

  return (
    <div className="octo-doc octo-doc--editor octo-theme octo-board">
      <header className="octo-doc-header">
        {onBack && (
          <button type="button" className="octo-doc-back" title={t('docs.list.back')} onClick={onBack}>
            ← {t('docs.list.back')}
          </button>
        )}
        <DocTitle docId={docId} initialTitle={title} canEdit={manage} onSaved={onTitleSaved} />
        <div className="octo-doc-header-right">
          {readOnly && <span className="octo-board-readonly">{t('docs.board.readOnly')}</span>}
          {manage && (
            <button
              type="button"
              className="octo-tb-btn octo-doc-delete-btn"
              title={t('docs.doc.deleteEntry')}
              onClick={del.requestDelete}
            >
              🗑 {t('docs.doc.deleteEntry')}
            </button>
          )}
        </div>
      </header>

      {del.confirming && (
        <div className="octo-docs-delete-confirm octo-doc-delete-confirm" role="alertdialog" aria-label={t('docs.doc.deleteConfirmTitle')}>
          <p className="octo-docs-delete-confirm-text">{t('docs.doc.deleteConfirm')}</p>
          <div className="octo-docs-delete-confirm-actions">
            <button type="button" className="octo-tb-btn" disabled={del.deleting} onClick={del.cancel}>
              {t('docs.doc.deleteCancel')}
            </button>
            <button type="button" className="octo-tb-btn octo-docs-delete-confirm-go" disabled={del.deleting} onClick={() => void del.confirm()}>
              {t('docs.doc.delete')}
            </button>
          </div>
        </div>
      )}
      {del.error && (
        <p className="octo-member-error" role="alert">
          {del.error}
        </p>
      )}

      <div className="octo-board-canvas">
        {failed ? (
          <div className="octo-board-state octo-error">{t('docs.state.error')}</div>
        ) : !Excalidraw ? (
          <div className="octo-board-state">{t('docs.state.loading')}</div>
        ) : (
          <BoardErrorBoundary>
            <Excalidraw
              initialData={{
                elements: initialElements,
                appState: initialSceneRef.current?.appState,
                files: initialSceneRef.current?.files,
                scrollToContent: true,
              }}
              onChange={onChange}
              excalidrawAPI={handleApi}
              collaborators={collaborators}
              onPointerUpdate={onPointerUpdate}
              viewModeEnabled={readOnly}
              theme={dark ? 'dark' : 'light'}
              langCode={langCode}
            />
          </BoardErrorBoundary>
        )}
      </div>
    </div>
  )
}
