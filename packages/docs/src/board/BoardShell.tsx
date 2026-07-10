import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react'
import { DocTitle } from '../editor/EditorShell.tsx'
import { DocTerminal } from '../editor/DocTerminal.tsx'
import { PresenceBar } from '../editor/PresenceBar.tsx'
import { DocMoreMenu, DeleteIcon, OpenNewPageIcon, HistoryIcon, type DocMoreMenuItem } from '../editor/DocMoreMenu.tsx'
import { MemberPanel } from '../members/MemberPanel.tsx'
import { BoardVersionPanel } from './BoardVersionPanel.tsx'
import { BoardErrorBoundary } from './BoardErrorBoundary.tsx'
import { useMemberNames } from '../members/useMemberNames.ts'
import { useAccessRequests } from '../access-request/useAccessRequests.ts'
import { startDocForward } from '../forward/startDocForward.ts'
import { canManage, canEdit } from '../auth/roles.ts'
import { useDocDelete } from '../editor/useDocDelete.ts'
import { getDoc, getUserName } from '../pages/docsApi.ts'
import type { Role } from '../auth/roles.ts'
import type { ConnState } from '../collab/createCollabEditor.ts'
import { i18n, t, getCurrentUid, canForwardToChat } from '../octoweb/index.ts'
import { loadBoardScene, persistBoardScene, clearBoardScene, forgetBoard, type BoardScene } from './boardStore.ts'
import { BoardMainMenu, type ExcalidrawMainMenu } from './BoardMainMenu.tsx'
import { installExcalidrawDebrand } from './excalidrawDebrand.ts'
import { installLibraryControlButtons } from './libraryControlButtons.ts'
import type { WhiteboardSession, BoardTerminal } from './collab/index.ts'
import type { ExcalidrawElement, BinaryFileData, FileFetchRef } from './collab/index.ts'
import { makeGenerateIdForFile, dataURLToBlob } from './collab/index.ts'
import { presignUpload, uploadBinary } from '../attachments/api.ts'
import { fetchBoardFileBinaries } from './boardFiles.ts'
import {
  setLocalPresenceUser,
  publishLocalPointer,
  clearLocalPointer,
  readBoardCollaborators,
  resolveCollaboratorNames,
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
  /**
   * Content-address a freshly inserted image file WITHOUT `crypto.subtle` (XIN-702 / P1). Excalidraw
   * 0.18.1's built-in id generator calls `crypto.subtle.digest`, which is undefined on plain-http LAN
   * and throws (caught into a non-deterministic nanoid fallback + a red console error). Supplying this
   * prop makes the id a stable FNV hash of the bytes that works in an insecure context.
   */
  generateIdForFile?: (file: File) => string | Promise<string>
  UIOptions?: Record<string, unknown>
  /** Custom menu / dialog composition rendered inside the canvas (we supply a de-branded MainMenu). */
  children?: ReactNode
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

/**
 * Excalidraw's `loadLibraryFromBlob(blob)` helper — parses a local `.excalidrawlib` file into
 * library items. Captured off the same client-only dynamic import as the component (like the
 * restore/reconcile helpers) so the header's local-import button (XIN-601) never depends on the
 * heavy chunk being statically imported.
 */
type LoadLibraryFromBlobFn = (blob: Blob) => Promise<unknown[]>

/**
 * Excalidraw's `serializeLibraryAsJSON(items)` helper — turns library items into the `.excalidrawlib`
 * JSON string the built-in "save to file" wrote. Captured off the same client-only dynamic import as
 * the component so the explicit save-to-file button (XIN-621 ①) never depends on the heavy chunk
 * being statically imported.
 */
type SerializeLibraryFn = (items: unknown[]) => string

/** The slice of the imperative Excalidraw API the library control buttons drive. */
interface ExcalidrawLibraryApi {
  updateLibrary: (opts: {
    libraryItems: unknown
    merge?: boolean
    openLibraryMenu?: boolean
  }) => Promise<unknown[]>
}

/** Debounce window for persisting scene edits (M1 local persistence). */
const SAVE_DEBOUNCE_MS = 600

export interface BoardShellProps {
  docId: string
  /** Fallback title until the real one is fetched (mirrors EditorShell). */
  title: string
  space: string
  /**
   * Folder segment of the whiteboard key (`octo:{space}:{folder}:wb:{board}`). Threaded through so
   * the header's "forward to chat" builds the same shareable link the doc editor does. Optional: the
   * standalone / M1 path may not know it, in which case forward falls back to space-only.
   */
  folder?: string
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
   * The host expects a collab session for this board (it is a permissioned, shared board), even
   * during the async window before `collabSession` is ready. When true the board fails CLOSED —
   * read-only, no cached-content hydration — until the session attaches and reports an authoritative
   * role, so the brief session-loading window can never fall open to an editable canvas (P1-2).
   * Omitted (false) only on the M1 standalone / dev path, which has no server permission model.
   */
  collab?: boolean
  /**
   * Local peer identity for presence (XIN-111). Published into `collabSession.provider.awareness`
   * so remote peers can label and colour this user's cursor / online avatar. Omitted on the M1
   * standalone path (no session), where presence is inert.
   */
  user?: BoardPresenceUser
  /**
   * When true, resolve the creator display name from the NICKNAME only, never the verified
   * `real_name`. Opt-in: defaults to false so the in-app board keeps preferring the real name
   * (AC non-regression). The standalone `/d/:docId` board surface sets this because it is an
   * externally shareable surface — showing the creator's legal name to any link holder is a
   * privacy leak (boss decision). Mirrors EditorShell's `creatorNicknameOnly` gate (XIN-392 P2-1).
   */
  creatorNicknameOnly?: boolean
  /**
   * "Open in new page" handler (in-app only). When provided, the header's ≡ "more" menu shows an
   * "Open in new page" row that opens the shareable standalone `/d/:docId` link — mirroring the doc
   * editor's EditorShell row (XIN-621 ②). Omitted on the standalone page itself (there is no
   * "open in a new page" from a page that already IS the standalone view), so the row won't render.
   */
  onOpenInNewPage?: () => void
}

/** Map the app locale (`zh-CN` / `en-US`) to an Excalidraw langCode (`zh-CN` / `en`). */
function toExcalidrawLang(locale: string): string {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/**
 * Stable, content-addressed file-id generator for Excalidraw's `generateIdForFile` prop (XIN-702).
 * Built once at module scope (it holds no state) so passing it to <Excalidraw> never changes the
 * prop identity across renders. Hashes the file bytes without `crypto.subtle`, so an image insert on
 * a plain-http LAN neither throws nor logs the digest error the built-in generator does.
 */
const boardGenerateIdForFile = makeGenerateIdForFile()

/**
 * Board image upload limits mirroring the backend attachments contract (XIN-701): the image tier is
 * 10 MB and `image/svg+xml` is denied (SVG can carry script → stored-XSS). The backend is the final
 * authority (it 400s on violation); these client-side guards just avoid a doomed round-trip and keep
 * an oversize/SVG paste from ever leaving the browser.
 */
const MAX_BOARD_IMAGE_BYTES = 10 * 1024 * 1024
const DENIED_IMAGE_MIME = new Set(['image/svg+xml'])

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
 * How often the live board rechecks its access while the tab is visible (P1 hot-path teardown).
 * Short enough that a deleted / revoked board an idle viewer is looking at tears down promptly, long
 * enough that an open board is not a meaningful load on GET /docs/:docId. A tab-focus / visibility
 * recheck (below) covers the common cross-tab flow immediately, so this interval is only the
 * same-tab backstop.
 */
export const BOARD_ACCESS_RECHECK_MS = 10_000

/**
 * Map a live access-recheck GET failure to the board terminal it represents — or null when the
 * failure is transient and must NOT tear the board down. Only the two DEFINITIVE access-lost
 * signals act: 403 (role revoked → mirror the 4403 close code's 'deleted' mapping) and 404 (board
 * deleted). Everything else — 401 token expiry, 409/423 lock, 5xx, or an offline network error — is
 * either transient or already owned by the WS / collab-token path, so a blip never falsely unmounts
 * a live canvas.
 */
function boardTerminalForAccessLoss(err: unknown): BoardTerminal | null {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 403) return { kind: 'deleted' }
  if (status === 404) return { kind: 'not-found' }
  return null
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
  const { docId, title, space, folder, onBack, onExit, onTitleSaved, onDeleted, collabSession, collab, user, creatorNicknameOnly, onOpenInNewPage } = props

  const [Excalidraw, setExcalidraw] = useState<ExcalidrawComponent | null>(null)
  // Excalidraw's `MainMenu` compound component, captured off the same dynamic import. Rendered as a
  // child of the canvas so our de-branded menu (no "Excalidraw links" group) replaces the built-in
  // fallback menu (XIN-531 item 1).
  const [MainMenu, setMainMenu] = useState<ExcalidrawMainMenu | null>(null)
  const [failed, setFailed] = useState(false)
  const [role, setRole] = useState<Role | undefined>(undefined)
  // Whether the role lookup / collab-token has resolved (success OR failure). Distinguishes
  // "still resolving" from "resolved but unknown" so the canvas can fail CLOSED (P1-2): an
  // unresolved or unknown role is treated as read-only, never editable.
  const [roleResolved, setRoleResolved] = useState(false)
  // Runtime terminal transition from the collab socket (4403 revoke / delete / lock — P1-3).
  const [terminal, setTerminal] = useState<BoardTerminal>({ kind: 'none' })
  // P2 #6: the standalone path has no other store, so a failed local save is silent data loss.
  // Flip this when persistBoardScene reports a failed write so the header can surface it.
  const [saveFailed, setSaveFailed] = useState(false)
  const [dark, setDark] = useState(prefersDark)

  // --- Header parity with the doc editor (XIN-601 item 2) ---
  // The board header now mirrors the doc editor's right-hand cluster (presence → forward → members
  // → ≡ more menu), so these back the same surfaces the doc shell drives.
  // Connection / sync status for the presence bar (derived from the collab provider, since the
  // board owns its session directly rather than through useCollabEditor).
  const [connState, setConnState] = useState<ConnState | null>(null)
  const [synced, setSynced] = useState(false)
  // Members modal toggle (manage role only), matching the doc editor's #A4 modal.
  const [membersOpen, setMembersOpen] = useState(false)
  // Version-history modal toggle (any role — reader+ can browse/preview; restore/delete gate to
  // admin inside the panel). Opened from the ≡ "more" menu, like the doc/sheet history entry.
  const [versionOpen, setVersionOpen] = useState(false)
  // Creator + creation date for the ≡ "more" menu head, fetched from the per-doc GET like EditorShell.
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined)
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined)
  const [creatorName, setCreatorName] = useState<string | undefined>(undefined)
  // Transient banner when a picked `.excalidrawlib` can't be parsed (mirrors the doc export-error banner).
  const [libraryImportError, setLibraryImportError] = useState<string | null>(null)

  // Authenticated identity for cache scoping (P1-1). The local mirror + IndexedDB cache are keyed
  // by this uid so a shared browser never exposes one user's board to the next.
  const uid = user?.id
  // Remote peers' presence (XIN-111): cursors + online list, rebuilt from provider.awareness on
  // every awareness `change`. Held in a REF, not React state (XIN-634 P1-b): awareness 'change'
  // fires on every remote pointer coordinate delta, and routing that through setState re-rendered
  // the whole BoardShell — header, ≡ menu, member panel — on every cursor move under multiple
  // peers. The map has NO React consumer that needs re-render: Excalidraw's `collaborators` prop is
  // inert in 0.18.1 (see below) so the only render path is the imperative api.updateScene, and the
  // online avatars come from PresenceBar, which subscribes to the provider itself. So the presence
  // listener pushes straight into the canvas and stashes the map here for a late-mounting canvas to
  // be primed with; empty on the M1 standalone path (no session).
  const collaboratorsRef = useRef<Map<string, BoardCollaborator>>(new Map())

  // XIN-115 (case8 presence_delta=0 v2 — real-runtime root cause): the `collaborators` PROP is INERT
  // in @excalidraw/excalidraw 0.18.1. It is declared on ExcalidrawProps, but the component wrapper
  // never forwards it to the inner canvas and never syncs it into `appState.collaborators` — the only
  // path that populates the remote cursors + online UserList is the imperative `api.updateScene({
  // collaborators })`. So presence data reached the bridge and propagated over awareness correctly
  // (XIN-111 made delta=1 at the data layer), yet nothing rendered: no remote cursor, no online
  // avatar, presence_delta on the canvas stayed 0. node tests never caught it because they assert
  // readBoardCollaborators (the Map) and never mount the real Excalidraw that ignores the prop.
  // Fix: hold the imperative API in state and push the map through updateScene. The push runs from
  // the awareness listener below (XIN-634 P1-b keeps it out of React state); this stays state (not
  // a ref) because the listener effect depends on it, so a canvas that mounts AFTER peers arrive
  // re-subscribes and replays the current map — covering either arrival order (peers resolved
  // before the heavy canvas chunk, or after).
  const [excalidrawApi, setExcalidrawApi] = useState<{
    updateScene: (scene: { collaborators: Map<string, BoardCollaborator> }) => void
  } | null>(null)

  // Excalidraw's restore/reconcile helpers, captured off the same dynamic import as the component
  // (XIN-87). Held in refs because they are pure module functions, not render state — they are read
  // by `handleApi` (to wire the binding's render adapter) and by the initialData memo below.
  const restoreElementsRef = useRef<RestoreElementsFn | null>(null)
  const reconcileElementsRef = useRef<ReconcileElementsFn | null>(null)
  // Excalidraw's `loadLibraryFromBlob` parser, captured off the same import. Read by the library
  // panel's import button (XIN-621 ①) to turn a picked `.excalidrawlib` file into library items.
  const loadLibraryFromBlobRef = useRef<LoadLibraryFromBlobFn | null>(null)
  // Excalidraw's `serializeLibraryAsJSON`, captured off the same import. Read by the save-to-file
  // button (XIN-621 ①) to serialize the current library for download.
  const serializeLibraryRef = useRef<SerializeLibraryFn | null>(null)
  // Raw imperative Excalidraw API handle, stashed by `handleApi` on canvas mount. Held in a ref (not
  // read during render) so the access-gated effect below can wire it into the binding once — and
  // only once — access is confirmed (P1a).
  const boardApiRef = useRef<unknown>(null)

  // Fail-closed editability (P1-2). On the collab (permissioned) path the canvas is read-only until
  // an authoritative editable role (writer/admin) is confirmed — an unresolved role, an unknown
  // role, a reader, or a runtime downgrade / terminal all keep it read-only, so a reader or a
  // meta-lookup failure can never fall open to editable. `collabMode` also covers the async window
  // BEFORE the session attaches (a collab board whose session is still loading), so that window
  // stays read-only rather than briefly editable. The standalone path (no collab expected) has no
  // server permission model, so it stays editable unless the meta explicitly says reader.
  const collabMode = collab ?? !!collabSession
  const terminalActive = terminal.kind !== 'none'
  // On the collab path editability additionally requires `roleResolved`, not just a truthy `role`.
  // `role` is shell state that outlives the collab session: an in-session account switch keeps this
  // shell mounted (BoardSession is keyed by docId only) while `useWhiteboardSession` (keyed by
  // `${uid}::${documentName}`) tears down and re-primes, so `collabSession` transitions through
  // `null` with the PREVIOUS account's `role` still set. Gating on `roleResolved` (reset to false
  // for the duration of that re-prime window) keeps the canvas read-only until the NEW account's
  // role is authoritatively resolved, matching `accessConfirmed` above and the fail-closed contract
  // — a stale `role` alone must never fall open to editable.
  const readOnly = collabMode
    ? terminalActive || !roleResolved || !(role !== undefined && canEdit(role))
    : role === 'reader'

  // Access is "confirmed" for hydrating the local mirror only once the collab path has an
  // authoritative role and no terminal transition. The standalone path (own-browser localStorage,
  // no cross-user concern beyond the uid scoping) is always confirmed. Gating hydration this way
  // means protected cached content is never painted before access is confirmed (P1-1).
  const accessConfirmed = collabMode ? roleResolved && role !== undefined && !terminalActive : true

  // Initial scene is read from the uid-scoped local mirror the first time access is confirmed, so a
  // reopened / refreshed board paints its own content — but never a previous user's, and never
  // before access is confirmed.
  const initialSceneRef = useRef<BoardScene | null>(null)
  const initialSceneLoadedRef = useRef(false)
  if (accessConfirmed && !initialSceneLoadedRef.current) {
    initialSceneLoadedRef.current = true
    initialSceneRef.current = loadBoardScene(docId, uid)
  }

  const langCode = toExcalidrawLang(i18n.getLocale ? i18n.getLocale() : 'en-US')

  // Manage capability drives the members entry, the delete row, and the pending-access badge.
  const manage = role ? canManage(role) : false
  // uid -> display name for this space: resolves the creator name for the ≡ menu head, and is the
  // same seam the member panel + presence caret use.
  const names = useMemberNames(space)
  // Pending access-request count for the Members-button badge (admin only). Called unconditionally
  // (hooks rules); the hook stays inert when not manage.
  const pendingAccess = useAccessRequests(docId, manage)
  // "Forward to chat" only when the host exposes the conversation-select surface the flow lands on
  // (absent on the standalone page), so the entry never renders as a silent no-op — same gate as the doc.
  const canForward = canForwardToChat()

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
          loadLibraryFromBlob?: LoadLibraryFromBlobFn
          serializeLibraryAsJSON?: SerializeLibraryFn
        }
        restoreElementsRef.current = m.restoreElements ?? null
        reconcileElementsRef.current = m.reconcileElements ?? null
        loadLibraryFromBlobRef.current = m.loadLibraryFromBlob ?? null
        serializeLibraryRef.current = m.serializeLibraryAsJSON ?? null
        setMainMenu(() => mod.MainMenu as unknown as ExcalidrawMainMenu)
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

  // Runtime de-brand of the Excalidraw 0.18.1 surfaces with no i18n/composition seam: the four
  // Help-dialog brand link buttons (XIN-531 item 2 / XIN-556), the "更多工具 → Mermaid 至 Excalidraw"
  // menu item and the Mermaid dialog title/description (XIN-531 items 3 & 4), plus the online "浏览
  // 素材库 / Browse libraries" entry in the library panel (XIN-557; local import/export/add/reuse are
  // preserved). Starts once the canvas is loaded; the observer covers both the in-canvas menu/panel
  // and the body-portal dialogs. Disposed on unmount / re-import.
  useEffect(() => {
    if (!Excalidraw || typeof document === 'undefined') return
    return installExcalidrawDebrand(document)
  }, [Excalidraw])

  // XIN-621 ① (was XIN-601): read a picked `.excalidrawlib` and load it through the imperative
  // library API. This is exactly what the library panel's "..." → "Load" item did; the injected
  // button just surfaces it explicitly. Reads the live api/parser off refs so the button — bound
  // once when the panel DOM mounts — always drives the current canvas.
  const importLibraryFromFile = useCallback(() => {
    const api = boardApiRef.current as ExcalidrawLibraryApi | null
    const parse = loadLibraryFromBlobRef.current
    if (!api?.updateLibrary || !parse || typeof document === 'undefined') return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.excalidrawlib,application/json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      setLibraryImportError(null)
      parse(file)
        .then((libraryItems) => api.updateLibrary({ libraryItems, merge: true, openLibraryMenu: true }))
        .catch((err) => {
          console.error('[board] library import failed', err)
          setLibraryImportError(t('docs.board.importLibraryError'))
        })
    })
    input.click()
  }, [])

  // XIN-621 ①: save the current library to a local `.excalidrawlib` file — the explicit counterpart
  // of the "..." → "Save to file" item. The imperative API exposes no `getLibraryItems`, so read the
  // live items through `updateLibrary`'s function form (it receives the current items and we return
  // them unchanged), then serialize + download. Skips silently when the library is empty so the
  // button never produces a meaningless empty file.
  const saveLibraryToFile = useCallback(() => {
    const api = boardApiRef.current as ExcalidrawLibraryApi | null
    const serialize = serializeLibraryRef.current
    if (!api?.updateLibrary || !serialize || typeof document === 'undefined') return
    api
      .updateLibrary({
        libraryItems: (current: unknown[]) => {
          if (Array.isArray(current) && current.length > 0) {
            const json = serialize(current)
            const blob = new Blob([json], { type: 'application/vnd.excalidrawlib+json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'library.excalidrawlib'
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
          }
          // Return the items unchanged — this is a read, not a mutation.
          return current
        },
        merge: false,
      })
      .catch((err) => {
        console.error('[board] library save failed', err)
      })
  }, [])

  // XIN-621 ①: clear the whole library — the explicit counterpart of the "..." → "Reset library"
  // item, which showed a confirm dialog before wiping. We keep that guard (a native confirm) so the
  // explicit button can't destroy a saved library on a stray click, then reset via `updateLibrary`
  // with an empty, non-merging set.
  const resetLibrary = useCallback(() => {
    const api = boardApiRef.current as ExcalidrawLibraryApi | null
    if (!api?.updateLibrary || typeof window === 'undefined') return
    if (!window.confirm(t('docs.board.resetLibraryConfirm'))) return
    api.updateLibrary({ libraryItems: [], merge: false }).catch((err) => {
      console.error('[board] library reset failed', err)
    })
  }, [])

  // XIN-621 ①: replace the library panel's "..." overflow with explicit import / save-to-file / reset
  // buttons in the control row, then remove the "..." entirely (boss ruling). Runs alongside the
  // de-brand observer once the canvas is loaded. Labels are resolved here so the injector stays
  // i18n-free.
  useEffect(() => {
    if (!Excalidraw || typeof document === 'undefined') return
    return installLibraryControlButtons(document, {
      import: { label: t('docs.board.importLibrary'), onClick: importLibraryFromFile },
      save: { label: t('docs.board.saveLibrary'), onClick: saveLibraryToFile },
      reset: { label: t('docs.board.resetLibrary'), onClick: resetLibrary },
    })
  }, [Excalidraw, importLibraryFromFile, saveLibraryToFile, resetLibrary])

  // Presence status for the header bar (XIN-601 item 2). The board owns its collab session directly
  // (not via useCollabEditor), so mirror that hook's wiring: seed from the provider's current state
  // and subscribe to its status/synced events. Inert on the M1 standalone path (no provider). Guarded
  // so a provider double that omits the event emitter (e.g. the presence dev harness) can't throw.
  useEffect(() => {
    const provider = collabSession?.provider as
      | {
          isSynced?: boolean
          synced?: boolean
          status?: ConnState
          on?: (ev: string, cb: (e: { status: ConnState }) => void) => void
          off?: (ev: string, cb: (e: { status: ConnState }) => void) => void
        }
      | undefined
    if (!provider) return
    setSynced(provider.isSynced ?? provider.synced ?? false)
    if (provider.status) setConnState(provider.status)
    if (typeof provider.on !== 'function' || typeof provider.off !== 'function') return
    const onStatus = (e: { status: ConnState }) => setConnState(e.status)
    const onSynced = () => setSynced(true)
    provider.on('status', onStatus)
    provider.on('synced', onSynced)
    return () => {
      provider.off!('status', onStatus)
      provider.off!('synced', onSynced)
    }
  }, [collabSession])

  // Creator + creation date for the ≡ "more" menu head (mirrors EditorShell). Non-fatal: the head
  // just won't show the created-on row / falls back to a short uid on failure.
  useEffect(() => {
    let cancelled = false
    getDoc(docId)
      .then((meta) => {
        if (cancelled) return
        if (typeof meta?.ownerId === 'string' && meta.ownerId) setOwnerId(meta.ownerId)
        if (typeof meta?.createdAt === 'string' && meta.createdAt) setCreatedAt(meta.createdAt)
      })
      .catch(() => {
        /* non-fatal: creator head just won't fully populate */
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  // Resolve the creator's display name: from the already-loaded space-member map first (free), else
  // via GET /users/:uid. Any failure leaves it undefined and the menu falls back to a short uid.
  useEffect(() => {
    if (!ownerId) return
    // In-app (creatorNicknameOnly unset): prefer the already-loaded space-member map — free, and
    // the same source the presence caret + member panel use.
    //
    // On the standalone (externally shared) board surface (creatorNicknameOnly), SKIP the member-map
    // primary source entirely (XIN-392 P2-1). Gating only the getUserName fallback on
    // creatorNicknameOnly would leave the member map as an ungated primary source that leaks a real
    // name the moment the backend fills member display names with verified names — the
    // no-leak-today guarantee rests on the implicit "member name is never a real name" contract.
    // A link holder must never see the creator's verified name, so resolve nickname-only regardless
    // of what the member map holds. Mirrors EditorShell.
    if (!creatorNicknameOnly) {
      const fromMembers = names.get(ownerId)
      if (fromMembers && fromMembers !== ownerId) {
        setCreatorName(fromMembers)
        return
      }
    }
    let cancelled = false
    // In-app resolves the verified real name (falling back to nickname); the standalone surface
    // forces nickname-only and never requests real_name.
    getUserName(ownerId, { preferRealName: !creatorNicknameOnly })
      .then((name) => {
        if (!cancelled && name) setCreatorName(name)
      })
      .catch(() => {
        /* keep the uid fallback */
      })
    return () => {
      cancelled = true
    }
  }, [ownerId, names, creatorNicknameOnly])

  // "Forward to chat" (reader+): recompute grant capability from the LIVE role at click time, same
  // as the doc editor. The bridge opens the host conversation-select.
  const onForwardToChat = useCallback(() => {
    if (!role) return
    startDocForward({
      docId,
      title,
      role,
      currentUid: getCurrentUid(),
      ownerId,
      space,
      folder,
    })
  }, [docId, title, role, ownerId, space, folder])

  // Resolve the caller's role for THIS board so a reader gets a read-only canvas.
  //
  // Collab path: the collab-token role (surfaced by the session, single source of truth as in the
  // doc editor) is authoritative, and runtime downgrades / terminal transitions arrive on the same
  // socket (P1-3). Subscribe to both. FAIL CLOSED — role stays undefined (→ read-only) until the
  // session reports an authoritative role. While a collab board's session is still loading
  // (`collabMode` but no session yet), do NOT fall back to the per-doc GET: stay unresolved (→
  // read-only) and let this effect re-run when the session attaches.
  //
  // Standalone path (no collab expected): fall back to the per-doc GET. On lookup failure we mark
  // the lookup resolved but leave role undefined; the standalone path has no server gate, so it
  // stays editable (the local-only board).
  useEffect(() => {
    let cancelled = false
    if (collabSession) {
      setRole(collabSession.getRole())
      setRoleResolved(true)
      setTerminal({ kind: 'none' })
      const offRole = collabSession.subscribeRole((r) => {
        if (!cancelled) setRole(r)
      })
      const offTerminal = collabSession.subscribeTerminal((tState) => {
        if (!cancelled) setTerminal(tState)
      })
      return () => {
        cancelled = true
        offRole()
        offTerminal()
      }
    }
    if (collabMode) {
      // Session expected but not ready yet — fail closed until it attaches (this effect re-runs).
      // Also clear any role carried over from a prior session/account: on an in-session account
      // switch this shell is not remounted, so a stale `role` (e.g. the previous account's
      // `writer`) would otherwise persist through the re-prime window. `readOnly` already gates on
      // `roleResolved` here, so this reset is defence-in-depth that also stops the stale value from
      // leaking into anything else that reads `role`.
      setRole(undefined)
      setRoleResolved(false)
      return () => {
        cancelled = true
      }
    }
    setRoleResolved(false)
    // Offline / non-auth standalone path (P2, yujiawei round-3): a prime failure here settles
    // role-resolution without an authoritative role, so the board stays editable against its OWN
    // uid-scoped local cache. This is intentional offline-first behavior — NOT a hole in the
    // fail-closed guarantee. The fail-closed contract (P1-3) is about EDITABILITY and CROSS-USER
    // ISOLATION on the collab path: never grant write / never hydrate someone else's data before an
    // authoritative role arrives. It is NOT about suppressing your own offline cache: the mirror is
    // keyed by this user's uid (persistBoardScene(docId, scene, uid)), never another user's and
    // never an auth-denied doc, and it self-heals the moment the server answers (a 403 downgrades
    // to reader). So do not mistake this branch for the P1-3 gap it deliberately is not.
    getDoc(docId)
      .then((meta) => {
        if (cancelled) return
        if (meta?.role) setRole(meta.role)
        setRoleResolved(true)
      })
      .catch(() => {
        // non-fatal: fall back to editable on the standalone path; server still enforces perms
        if (!cancelled) setRoleResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [docId, collabSession, collabMode])

  // Debounced local persistence of scene edits. The timer is cleared on unmount and a final flush
  // is forced so a quick draw-then-close still saves (the close/reopen acceptance path).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestScene = useRef<BoardScene | null>(null)

  // Write the uid-scoped local mirror and surface a failure (P2 #6). On the standalone path the
  // local mirror is the ONLY store, so a failed write (quota exceeded / storage disabled) is silent
  // data loss unless we flag it. On the collab path the Y.Doc/provider is the authoritative store,
  // so a local-mirror miss is just a degraded offline cache — not reported as a save failure.
  const persistLocal = useCallback(
    (scene: BoardScene) => {
      const ok = persistBoardScene(docId, scene, uid)
      if (!collabMode) setSaveFailed(!ok)
    },
    [docId, uid, collabMode],
  )

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (latestScene.current) persistLocal(latestScene.current)
  }, [persistLocal])

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
        if (latestScene.current) persistLocal(latestScene.current)
      }, SAVE_DEBOUNCE_MS)
    },
    [readOnly, collabSession, persistLocal],
  )

  // M2: capture the imperative Excalidraw API on canvas mount. It feeds two consumers: presence
  // (XIN-115, via `excalidrawApi` state) and the collab binding. The binding is deliberately NOT
  // wired here — `binding.setApi` triggers `applyRemote`, which would paint the IndexedDB-hydrated /
  // provider-synced Y.Doc scene, so it must wait until access is confirmed (P1a). The gated effect
  // below does that wiring; here we only stash the raw handle and flag the canvas as mounted.
  const handleApi = useCallback((api: unknown) => {
    boardApiRef.current = api
    setExcalidrawApi(api as { updateScene: (scene: { collaborators: Map<string, BoardCollaborator> }) => void })
  }, [])

  // XIN-702 image binary bridge. Upload a freshly inserted image to the doc object store and return
  // its durable attachId (the binding mirrors it into the Y.Doc file ref so peers can fetch it); on a
  // remote apply the fetcher pulls a peer's binary by attachId back into a dataURL for addFiles().
  // Both reuse the existing docs attachments contract (`/docs/{docId}/attachments/*`) — a board IS a
  // doc, so its member auth already scopes these routes (BE half XIN-701). Base64 never enters the
  // Y.Doc: only the attachId (durable) and the transient dataURL (local canvas only) move.
  const uploadBoardFile = useCallback(
    async (file: BinaryFileData): Promise<string | null> => {
      if (!file.dataURL) return null
      const blob = dataURLToBlob(file.dataURL)
      if (!blob) return null // already a remote URL, or not decodable — nothing to upload
      const mime = file.mimeType ?? blob.type ?? 'application/octet-stream'
      // Contract limits (XIN-701): SVG is denied (XSS), image tier caps at 10 MB. Skip the upload
      // rather than fire a request the backend will 400; the image still renders locally for the
      // author, it just does not sync — surfaced in the console for diagnosis.
      if (DENIED_IMAGE_MIME.has(mime)) {
        console.warn('[board] image type not allowed for upload:', mime)
        return null
      }
      if (blob.size > MAX_BOARD_IMAGE_BYTES) {
        console.warn('[board] image exceeds the 10MB limit, not uploaded:', blob.size)
        return null
      }
      const presign = await presignUpload(docId, {
        fileName: file.id,
        mime,
        sizeBytes: blob.size,
      })
      await uploadBinary(presign, blob)
      return presign.attachId
    },
    [docId],
  )
  // Batch-resolve fresh signed GET urls in ONE round trip (contract: POST /attachments/resolve),
  // then download each binary. Shared with the version-history preview (boardFiles.ts) so the live
  // canvas and the historical preview can never drift onto different fetch/decoding paths.
  const fetchBoardFiles = useCallback(
    (refs: readonly FileFetchRef[]): Promise<BinaryFileData[]> => fetchBoardFileBinaries(docId, refs),
    [docId],
  )

  // P1a: gate the imperative binding replay (setApi → applyRemote → updateScene) and the
  // restore/reconcile adapter (XIN-87) on `accessConfirmed`. The declarative gates already withhold
  // cached content — `initialElements` returns [] and the local mirror is not loaded before access
  // is confirmed — but the Y.Doc's IndexedDB path is NOT declarative: `IndexeddbPersistence`
  // hydrates the cached scene into the Y.Doc unconditionally and `observeDeep` is live from binding
  // construction. Wiring `setApi` before access was confirmed let that hydrated/synced scene paint
  // through `applyRemote`, so a cache-enabled board could draw its canvas ahead of an authoritative
  // role — the exact bypass this closes. Keeping the binding's api null until `accessConfirmed` also
  // neutralises the live observe→applyRemote path (applyRemote no-ops on a null api), so the gate is
  // a real floor, not a declarative-only one. Re-runs when access flips or the canvas (re)mounts;
  // the cleanup detaches on access loss (terminal / downgrade) so a revoke cannot repaint.
  useEffect(() => {
    const binding = collabSession?.binding
    const api = boardApiRef.current
    if (!binding || !excalidrawApi || !api || !accessConfirmed) return
    binding.setApi(api as Parameters<WhiteboardSession['binding']['setApi']>[0])

    const restore = restoreElementsRef.current
    const reconcile = reconcileElementsRef.current
    if (restore && reconcile) {
      const imperative = api as { getAppState?: () => unknown }
      binding.setRenderAdapter({
        restore: (remote) => restore(remote, null),
        reconcile: (local, restoredRemote) => reconcile(local, restoredRemote, imperative.getAppState?.()),
      })
    }
    // XIN-702: wire the image object-store bridge so inserts upload (attachId → Y.Doc ref) and remote
    // images rehydrate (fetch by attachId → addFiles). Gated on the same accessConfirmed floor.
    binding.setFileSync({ uploader: uploadBoardFile, fetcher: fetchBoardFiles })
    return () => {
      // Access lost or the session/canvas swapped: detach the api so no further applyRemote can
      // paint, and drop the adapter. setApi(null) only clears the handle — it never pushes a scene.
      binding.setApi(null)
      binding.setRenderAdapter(null)
      binding.setFileSync(null)
    }
  }, [collabSession, accessConfirmed, excalidrawApi, uploadBoardFile, fetchBoardFiles])

  // Presence (XIN-111 / case8 presence_delta=0). The board opened a real HocuspocusProvider for
  // content sync (XIN-55) but never wired presence onto it — the binding's __awareness was a
  // local-only stub that never touched provider.awareness, so A's cursor/online state never
  // reached B (presence_delta stayed 0 while canvas content synced fine). Mirror the doc editor:
  // publish this peer's identity into provider.awareness and rebuild the Excalidraw `collaborators`
  // map from remote peers on every awareness change. Volatile only — never the Y.Doc, so the 0-7
  // content path is untouched.
  //
  // XIN-634 P1-b: push the map into the canvas IMPERATIVELY inside the change listener, with no
  // setState round-trip — a remote cursor delta fires 'change' continuously, and re-rendering the
  // whole shell on every one was the thrash. The `collaborators` prop is inert in Excalidraw 0.18.1
  // (XIN-115), so api.updateScene is the sole render path and needs no React state. `excalidrawApi`
  // is a dependency so that a canvas mounting AFTER peers are already present re-subscribes and
  // replays the current map once the API resolves (covering either arrival order the previous
  // two-effect state+push design handled).
  useEffect(() => {
    const awareness = collabSession?.provider?.awareness
    if (!awareness) return
    if (user) setLocalPresenceUser(awareness, user)
    const update = () => {
      // Resolve each remote peer's cursor/online label from THIS client's space-member directory
      // (`names`), keyed by the peer's uid — the same seam MemberPanel and the doc caret use. A peer
      // whose own member list had not resolved broadcasts its raw uid, which surfaced verbatim in
      // the label (XIN-680); the viewer's directory is authoritative, so it wins when known. Re-runs
      // when `names` resolves (dep below), so a late-loading directory relabels peers in place.
      const map = resolveCollaboratorNames(readBoardCollaborators(awareness), names)
      collaboratorsRef.current = map
      excalidrawApi?.updateScene({ collaborators: map })
    }
    update()
    awareness.on('change', update)
    return () => {
      awareness.off('change', update)
      // Drop our cursor so peers stop drawing a stale one once we leave this board.
      clearLocalPointer(awareness)
    }
  }, [collabSession, user, excalidrawApi, names])

  // Excalidraw's live pointer (scene coords) → provider.awareness, so remote peers render this
  // cursor. No Y.Doc write; inert when there is no session.
  const onPointerUpdate = useCallback<ExcalidrawPointerUpdate>(
    (payload) => {
      const awareness = collabSession?.provider?.awareness
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
      clearBoardScene(id, uid)
      // Also drop the board-kind registry entry: `clearBoardScene` only removes the scene mirror,
      // so without this the `octo.board.ids.{uid}` registry keeps a "this docId is a board" record
      // for a now-deleted board and grows unbounded / mislabels a later reused id as a board.
      forgetBoard(id, uid)
      if (onDeleted) onDeleted(id)
      else returnToList?.()
    },
    [onDeleted, returnToList, uid],
  )
  const del = useDocDelete(docId, handleDeleted)

  // P1-3: a runtime access-loss on the collab socket (4403 → 'deleted', or 'not-found') means the
  // board this user was editing is gone. Mirror the doc editor's terminal handling and return them
  // to the list. 'locked' / 'login' keep the board mounted read-only (the readOnly gate already
  // covers editing) so the user sees why it froze rather than being bounced.
  //
  // P1-1: also drop the uid-scoped localStorage scene mirror on the revoke transition. The collab
  // session's close-code machine tears down the IndexedDB cache (connect.ts `clearDocCache`), but
  // the scene mirror (`octo.board.scene.{uid}.{docId}`) is separate and would otherwise survive —
  // replayable on a later direct open before auth re-stabilizes. Clearing both closes the
  // data-at-rest gap for a revoked/deleted board.
  useEffect(() => {
    if (terminal.kind === 'deleted' || terminal.kind === 'not-found') {
      // Cancel the pending debounced save and drop the in-flight scene snapshot BEFORE clearing the
      // mirror. An edit made just before the revoke leaves a saveTimer armed (SAVE_DEBOUNCE_MS) with
      // `latestScene` populated; without this cancel that timer fires ~600ms after the clear and
      // re-persists the wiped scene to `octo.board.scene.{uid}.{docId}`, reopening the P1-1
      // data-at-rest gap this teardown closes. onChange already early-returns once `terminalActive`,
      // so no new timer can be scheduled past this point — cancelling the armed one is sufficient.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      latestScene.current = null
      clearBoardScene(docId, uid)
      returnToList?.()
    }
  }, [terminal, returnToList, docId, uid])

  // P1 hot-path teardown (live standalone revoke / delete). The collab socket delivers NO terminal
  // signal to an IDLE viewer when the board is deleted or access is revoked ELSEWHERE: the backend
  // only reacts to a stale WRITE (beforeHandleMessage flips the connection read-only + rejects the
  // frame), so a viewer who is not editing is never kicked, and the 4403 → 'deleted' close-code
  // chain the cold path relies on simply never fires for a passive live viewer. The last-synced
  // scene therefore keeps painting on the open standalone page even though the board is gone.
  //
  // Actively recheck access on the collab path so an open board tears itself down on a runtime 403
  // (revoked) / 404 (deleted) WITHOUT any socket traffic — mirroring the cold-path GET /docs/:docId
  // preflight, but on the LIVE session. It rechecks the moment the tab regains focus / visibility
  // (the real flow: the board is deleted in another tab, then this one is looked at again) and on a
  // steady backstop interval while visible. Only the two definitive signals act (see
  // boardTerminalForAccessLoss); transient failures never unmount a live canvas. Standalone boards
  // have no resident list (returnToList is undefined), so the terminal render branch below is what
  // actually removes the revoked content there — this effect is only what makes it fire.
  useEffect(() => {
    if (!collabMode || terminalActive) return
    let cancelled = false
    const recheck = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      getDoc(docId, space ? { spaceId: space } : undefined)
        .then(() => {
          // 200 — access intact; keep the board mounted.
        })
        .catch((err: unknown) => {
          if (cancelled) return
          const next = boardTerminalForAccessLoss(err)
          if (next) setTerminal(next)
        })
    }
    const timer = setInterval(recheck, BOARD_ACCESS_RECHECK_MS)
    if (typeof window !== 'undefined') window.addEventListener('focus', recheck)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', recheck)
    return () => {
      cancelled = true
      clearInterval(timer)
      if (typeof window !== 'undefined') window.removeEventListener('focus', recheck)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', recheck)
    }
  }, [collabMode, terminalActive, docId, space])

  // Restore the initially-loaded scene before feeding it to Excalidraw (XIN-87). The local mirror
  // (and, on a cold reopen, the Y.Doc state that seeded it) can hold raw elements; handing those to
  // `initialData` unrestored is why a reopened board replayed empty. Gated on `Excalidraw` so the
  // restore helper (captured in the same import) is present; falls back to raw if unavailable.
  const initialElements = useMemo<unknown[]>(() => {
    // Fail closed (P1-1): do not hydrate any cached / synced content before access is confirmed.
    if (!accessConfirmed) return []
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
  }, [Excalidraw, collabSession, accessConfirmed])

  // P1 (revoke teardown, standalone share page): a runtime terminal transition — 4403 access
  // revoked / board deleted (→ 'deleted'), 'not-found', 'locked', or session-lost 'login' — must
  // TEAR DOWN the canvas, not merely flip it read-only. The `readOnly` gate above only disables
  // editing; it leaves <Excalidraw viewModeEnabled> mounted, so the last-synced scene keeps
  // painting. On the standalone /d/:docId share page there is also no resident list to return to,
  // so `onExit`/`onBack` are undefined and the terminal effect below (returnToList) is a no-op —
  // meaning without this branch a revoked user would keep seeing the whole board. Mirror
  // EditorShell (:454-471): replace the ENTIRE subtree with the shared <DocTerminal>, which
  // unmounts <Excalidraw> and removes its canvas from the DOM. `onBack` is forwarded when present,
  // so the in-app path (DocsHome supplies onBack/onExit) keeps its Back control and gains parity
  // for locked/login, while the standalone path renders a bare terminal card with no Back link.
  if (terminal.kind !== 'none') {
    return <DocTerminal title={title} kind={terminal.kind} onBack={onBack} />
  }

  // ≡ "more" menu (XIN-601 item 2 / XIN-621 ②): delete is collapsed into the destructive slot,
  // matching the doc editor. The neutral item list holds "Open in new page" when the host wired the
  // handler (in-app path) — mirroring EditorShell — and the version-history entry (consuming the P1
  // board version REST). Creator name falls back to a short uid → placeholder, so the head never
  // blanks or crashes on a miss.
  const moreItems: DocMoreMenuItem[] = []
  if (onOpenInNewPage) {
    moreItems.push({
      key: 'open-new-page',
      label: t('docs.standalone.openInNewPage'),
      icon: OpenNewPageIcon,
      onClick: onOpenInNewPage,
    })
  }
  moreItems.push({
    key: 'history',
    label: t('docs.toolbar.history'),
    icon: HistoryIcon,
    onClick: () => setVersionOpen((v) => !v),
  })
  const deleteItem: DocMoreMenuItem | undefined = manage
    ? {
        key: 'delete',
        label: t('docs.board.deleteEntry'),
        icon: DeleteIcon,
        danger: true,
        onClick: del.requestDelete,
      }
    : undefined
  const creatorDisplay =
    creatorName || (ownerId ? ownerId.slice(0, 8) : t('docs.moreMenu.unknownCreator'))

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
          {/* Board-specific status badges (no doc counterpart) lead the cluster. */}
          {readOnly && <span className="octo-board-readonly">{t('docs.board.readOnly')}</span>}
          {saveFailed && (
            <span className="octo-board-save-error" role="alert" title={t('docs.board.saveFailed')}>
              ⚠ {t('docs.board.saveFailed')}
            </span>
          )}
          {/* From here the cluster mirrors the doc header: presence → forward → members → ≡ more.
              Comments are dropped (doc-specific: they anchor to text ranges the board has none of). */}
          {collabSession?.provider && (
            <PresenceBar provider={collabSession.provider} connState={connState} synced={synced} names={names} />
          )}
          {role && canForward && (
            <button
              type="button"
              className="octo-tb-btn octo-doc-forward-btn"
              title={t('docs.forward.entry')}
              onClick={onForwardToChat}
            >
              ⤴ {t('docs.forward.entry')}
            </button>
          )}
          {manage && (
            <button
              type="button"
              className={membersOpen ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              aria-pressed={membersOpen}
              onClick={() => setMembersOpen((v) => !v)}
            >
              {t('docs.toolbar.members')}
              {pendingAccess.count > 0 && (
                <span className="octo-access-badge" aria-label={t('docs.forward.pendingTitle')}>
                  {pendingAccess.count}
                </span>
              )}
            </button>
          )}
          <DocMoreMenu
            creatorName={creatorDisplay}
            createdAt={createdAt}
            items={moreItems}
            dangerItem={deleteItem}
          />
        </div>
      </header>

      {libraryImportError && (
        <p className="octo-member-error" role="alert">
          {libraryImportError}
        </p>
      )}

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
              // Kept for intent/forward-compat, but inert in 0.18.1 — presence actually renders via
              // the imperative api.updateScene({ collaborators }) in the awareness listener (XIN-115
              // / XIN-634 P1-b). Reads the ref (never triggers a re-render) purely so the prop still
              // reflects the current map for anything that later honors it.
              collaborators={collaboratorsRef.current}
              onPointerUpdate={onPointerUpdate}
              viewModeEnabled={readOnly}
              theme={dark ? 'dark' : 'light'}
              langCode={langCode}
              // XIN-702 / P1: content-address inserted images without crypto.subtle so an insert on a
              // plain-http LAN does not throw the digest error and yields a peer-stable file id.
              generateIdForFile={boardGenerateIdForFile}
            >
              {/* De-branded hamburger menu: Excalidraw's default items minus the "Excalidraw
                  links" (Socials) group (XIN-531 item 1). */}
              {MainMenu && <BoardMainMenu MainMenu={MainMenu} />}
            </Excalidraw>
          </BoardErrorBoundary>
        )}
      </div>

      {/* Manage members opens a dedicated modal (mirrors the doc editor's #A4 modal, not a drawer). */}
      {membersOpen && manage && role && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={() => setMembersOpen(false)}>
          <div
            className="octo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.member.manage')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MemberPanel
              docId={docId}
              role={role}
              space={space}
              ownerId={ownerId}
              accessRequests={pendingAccess}
              onClose={() => setMembersOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Version history opens a dedicated modal (like members), wide enough for the read-only scene
          preview. Available to any role: reader+ can browse/preview, restore/delete gate to admin
          inside the panel. */}
      {versionOpen && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={() => setVersionOpen(false)}>
          <div
            className="octo-modal octo-board-version-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.board.version.title')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <BoardVersionPanel
              docId={docId}
              role={role ?? 'reader'}
              dark={dark}
              names={names}
              onClose={() => setVersionOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
