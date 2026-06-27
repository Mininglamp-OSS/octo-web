// Whiteboard collaborative session assembler (binding skeleton, frontend-design §5 / XIN-16 §5).
//
// Owns one Y.Doc + one HocuspocusProvider + one ExcalidrawYjsBinding + optional offline cache per
// board — the board counterpart of CollabEditor. It does NOT mount Excalidraw; BoardShell mounts
// the canvas, then hands the imperative API to `binding.setApi(api)` and forwards `onChange` to
// `binding.handleLocalChange(elements, files)`.
//
// Network specifics that depend on the (not-yet-final) board collab-token contract are injected by
// the caller (`url`, `token`) rather than hard-wired here, so this assembler does not bake in an
// unconfirmed backend endpoint. The doc name is built through the validated codec.

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'

import { buildWhiteboardName } from './schema.ts'
import { ExcalidrawYjsBinding } from './binding.ts'

export interface WhiteboardSessionOptions {
  space: string
  folder: string
  board: string
  /** Hocuspocus WebSocket endpoint. */
  url: string
  /** Collab-token provider (board collab-token contract supplies this). Matches Hocuspocus. */
  token: string | (() => string) | (() => Promise<string>)
  /** Disable the local IndexedDB cache for high-confidentiality boards. */
  disableOfflineCache?: boolean
}

export interface WhiteboardSession {
  readonly documentName: string
  readonly ydoc: Y.Doc
  readonly provider: HocuspocusProvider
  readonly persistence: IndexeddbPersistence | null
  readonly binding: ExcalidrawYjsBinding
  destroy(): void
}

/**
 * Assemble a live whiteboard collaboration session. The returned `binding` is wired to the doc but
 * has no canvas yet — call `binding.setApi(excalidrawAPI)` once Excalidraw has mounted.
 */
export function createWhiteboardSession(opts: WhiteboardSessionOptions): WhiteboardSession {
  const documentName = buildWhiteboardName(opts.space, opts.folder, opts.board)
  const ydoc = new Y.Doc()

  const persistence = opts.disableOfflineCache
    ? null
    : new IndexeddbPersistence(documentName, ydoc)

  const tokenOpt = opts.token
  const provider = new HocuspocusProvider({
    url: opts.url,
    name: documentName,
    document: ydoc,
    token: typeof tokenOpt === 'function' ? tokenOpt : () => tokenOpt,
  })

  const binding = new ExcalidrawYjsBinding(ydoc)

  return {
    documentName,
    ydoc,
    provider,
    persistence,
    binding,
    destroy(): void {
      binding.destroy()
      provider.destroy()
      persistence?.destroy()
      ydoc.destroy()
    },
  }
}
