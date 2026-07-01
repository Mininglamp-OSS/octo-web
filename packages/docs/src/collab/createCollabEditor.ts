// Collaborative editor assembly (frontend-design §4 / §6 / §7).
//
// Owns exactly one Y.Doc + one HocuspocusProvider + one Editor + one IndexeddbPersistence
// per document, and wires the close-code state machine and stateless role controller.
//
// Initial role is the single source of truth from the collab-token response: setEditable is
// set BEFORE connect (not from a first stateless frame). Stateless / close listeners are
// registered before connect so no runtime frame is missed.

import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'

import { buildDocumentName } from '../documentName/index.ts'
import { resolveCollabWsUrl } from '../config.ts'
import { canEdit, type Role } from '../auth/roles.ts'
import { getCollabToken, getCollabTokenEntry, disposeToken } from '../auth/collabToken.ts'
import { cacheKey, clearDocCache as clearDocCacheOrdered, type DocScope } from '../offline/cache.ts'
import { buildExtensions } from '../editor/extensions.ts'
import { RoleController } from './statelessRole.ts'
import { CloseCodeMachine, type CloseEvent } from './closeCode.ts'

export type ConnState = 'connecting' | 'connected' | 'disconnected'
export type TerminalState =
  | { kind: 'none' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'locked' }
  | { kind: 'login' }
  /**
   * In-flight loss of access while connected — the WS reported 4403 (document deleted, member
   * removed, or role downgraded to none). Distinct from a create-time `forbidden` (non-member
   * opening a doc): this one returns the user to the list (#1 / passive recheck), since the doc
   * they were editing is gone. NOT a reconnect — the close-code machine already marks it terminal.
   */
  | { kind: 'deleted' }

export interface CollabEditorOptions {
  uid: string
  space: string
  folder: string
  doc: string
  /** Stable doc id for REST (members, attachments). Bare-relative `/docs/{docId}/...`. */
  docId: string
  user: { id: string; name: string; avatar?: string }
  /** Disable local persistence for high-confidentiality docs (§6.4). */
  disableOfflineCache?: boolean
  /** UI callbacks. */
  onRole?: (role: Role) => void
  onConnState?: (state: ConnState) => void
  onTerminal?: (state: TerminalState) => void
}

export class CollabEditor {
  readonly documentName: string
  readonly ydoc: Y.Doc
  readonly provider: HocuspocusProvider
  readonly editor: Editor
  readonly persistence: IndexeddbPersistence | null

  private readonly cacheKeyStr: string
  private readonly roleController: RoleController
  private readonly closeMachine: CloseCodeMachine
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private ready = false
  private readonly readyListeners = new Set<() => void>()
  private destroyed = false

  private constructor(
    opts: CollabEditorOptions,
    initialRole: Role,
    initialEpoch: number,
    wsUrl: string,
  ) {
    const scope: DocScope = { uid: opts.uid, space: opts.space, folder: opts.folder, doc: opts.doc }
    this.documentName = buildDocumentName(opts.space, opts.folder, opts.doc)
    this.cacheKeyStr = cacheKey(scope)

    // 1) single Y.Doc
    this.ydoc = new Y.Doc()

    // 2) local persistence before network (only after identity confirmed — see create()).
    this.persistence = opts.disableOfflineCache
      ? null
      : new IndexeddbPersistence(this.cacheKeyStr, this.ydoc)

    // 3) provider — connect:false; we set initial editable then connect.
    // WS origin is resolved from the collab-token response (backend-driven) — see
    // resolveCollabWsUrl / create().
    this.provider = new HocuspocusProvider({
      url: wsUrl,
      name: this.documentName,
      document: this.ydoc,
      token: () => getCollabToken(this.documentName),
      connect: false,
    })

    // 4) editor — initial editable from collab-token role (single source of truth).
    this.editor = new Editor({
      extensions: buildExtensions({ ydoc: this.ydoc, provider: this.provider, user: opts.user, docId: opts.docId, spaceId: opts.space }),
      editable: canEdit(initialRole),
    })

    // Role controller: runtime stateless role changes (monotonic epoch).
    this.roleController = new RoleController({
      documentName: this.documentName,
      initialRole,
      initialEpoch,
      onRole: (role) => {
        this.editor.setEditable(canEdit(role))
        opts.onRole?.(role)
      },
    })

    // Close-code state machine: the only auth-recovery source is event.code.
    this.closeMachine = new CloseCodeMachine({
      disposeToken: () => disposeToken(this.documentName),
      connect: () => this.provider.connect(),
      disconnect: () => this.provider.disconnect(),
      goLogin: () => opts.onTerminal?.({ kind: 'login' }),
      // 4403 while connected = the doc was deleted / access was revoked under us. Surface it as
      // the terminal 'deleted' state so EditorShell returns to the list (NOT the static
      // create-time 'forbidden' screen). The close-code machine still owns the no-reconnect
      // decision; this only maps the side-effect to the docs-side terminal state.
      showForbidden: () => opts.onTerminal?.({ kind: 'deleted' }),
      exitDocument: () => opts.onTerminal?.({ kind: 'not-found' }),
      showLockedOrArchived: () => opts.onTerminal?.({ kind: 'locked' }),
      clearDocCache: () => {
        void this.clearCache()
      },
      rollbackPending: () => this.rollbackPending(),
      onTransientClose: () => {
        // Network blip: provider has built-in backoff reconnect; nothing extra to do.
        opts.onConnState?.('disconnected')
      },
      deferReconnect: ({ delayMs }) => {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => {
          if (!this.destroyed && !this.closeMachine.isTerminated()) this.provider.connect()
        }, delayMs)
      },
      reportServerError: (event) => {
        // Hook for telemetry; kept side-effect free in this build.
        void event
      },
      backoffDelay: () => 5_000,
    })

    // Listeners registered BEFORE connect.
    this.provider.on('status', (e: { status: ConnState }) => opts.onConnState?.(e.status))
    this.provider.on('synced', () => {
      this.closeMachine.onAuthStable()
      this.markReady()
    })
    this.provider.on('authenticated', () => {
      this.closeMachine.onAuthStable()
    })
    this.provider.on('stateless', (e: { payload: string }) => {
      this.roleController.handleStatelessFrame(e.payload)
    })
    this.provider.on('close', (e: { event: CloseEvent }) => {
      this.closeMachine.handleClose(e.event)
    })

    if (this.persistence) {
      this.persistence.on('synced', () => this.markReady())
    } else {
      // No local cache: readiness depends on the provider sync only.
    }

    // Now connect.
    this.provider.connect()
  }

  /**
   * Identity-first construction (§6.1): confirm identity + issue collab token (which yields
   * the initial role/epoch) BEFORE building persistence/provider and rendering any body.
   */
  static async create(opts: CollabEditorOptions): Promise<CollabEditor> {
    const documentName = buildDocumentName(opts.space, opts.folder, opts.doc)
    const entry = await getCollabTokenEntry(documentName)
    // The collab-token response is the single source of truth for the WS origin: the
    // backend-issued `collabWsUrl` is required. resolveCollabWsUrl throws when it is absent, so a
    // misconfigured backend fails loudly here instead of silently connecting to a placeholder.
    const wsUrl = resolveCollabWsUrl(entry.collabWsUrl)
    return new CollabEditor(opts, entry.role, entry.permission_epoch, wsUrl)
  }

  getRole(): Role {
    return this.roleController.getRole()
  }

  isReady(): boolean {
    return this.ready
  }

  subscribeReady(cb: () => void): () => void {
    this.readyListeners.add(cb)
    return () => this.readyListeners.delete(cb)
  }

  private markReady(): void {
    if (this.ready) return
    this.ready = true
    for (const cb of this.readyListeners) cb()
  }

  /** Roll back optimistic local edits made while downgraded (§7.5 P1-4). */
  private rollbackPending(): void {
    // Stop accepting further local transactions; default safe strategy is destroy-and-reload
    // (handled by clearCache on terminal codes). Here we simply lock the editor.
    this.editor.setEditable(false)
  }

  private async clearCache(): Promise<void> {
    await clearDocCacheOrdered(this.cacheKeyStr, {
      freezeUI: () => this.editor.setEditable(false),
      broadcastClose: () => {
        // BroadcastChannel coordination would notify sibling tabs here.
      },
      disconnectProvider: () => this.provider.disconnect(),
      destroyProvider: () => this.provider.destroy(),
      destroyEditor: () => this.editor.destroy(),
      destroyLocalPersistence: async () => {
        if (this.persistence) await this.persistence.destroy()
      },
    })
  }

  /** Strict teardown (frontend-design §4.3). */
  destroyAll(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.editor.destroy()
    this.provider.destroy()
    void this.persistence?.destroy()
    this.ydoc.destroy()
    disposeToken(this.documentName, /* uid implicit current */ undefined)
  }
}
