// Real-browser collaboration smoke for the XIN-87 restore/reconcile fix.
//
// This harness exists because @excalidraw/excalidraw cannot be imported under jsdom/node, so the
// "renders as points/handles" symptom only reproduces against the REAL Excalidraw renderer. It
// drives the PRODUCTION BoardShell + ExcalidrawYjsBinding + the BoardShell-wired restore/reconcile
// adapter, simulating the wire with Y.applyUpdate (exactly what HocuspocusProvider does when a
// remote update lands on the local Y.Doc). It is dev-only and never shipped.
//
//   Panel A      — author. Edits flow A.binding.handleLocalChange → docA.
//   Panel B-fix  — production path: BoardShell wires the restore/reconcile adapter onto its
//                  binding; docA updates cross-apply into docB → applyRemote → restore → reconcile
//                  → updateScene on the real canvas.
//   Panel B-raw  — control: the SAME elements pushed straight to updateScene WITHOUT restore (the
//                  pre-fix behaviour), so the screenshot shows fixed-vs-broken side by side.
//   Panel Reopen — a fresh BoardShell whose local mirror holds the RAW elements (the reopen case):
//                  initialData is restored before being fed, so the replay is non-empty.

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { setWKApp } from '../src/octoweb/index.ts'
import { createMockWKApp } from '../src/octoweb/mock.ts'
import { BoardShell } from '../src/board/BoardShell.tsx'
import { ExcalidrawYjsBinding } from '../src/board/collab/index.ts'
import type { WhiteboardSession, ExcalidrawElement } from '../src/board/collab/index.ts'
import { persistBoardScene } from '../src/board/boardStore.ts'

// ── mock backend so BoardShell's getDoc resolves an editable (admin) board ────────────────────
const wk = createMockWKApp({ uid: 'u_smoke', token: 'dev-smoke-token' })
wk.apiClient.responder = (_method, rawUrl) => {
  const url = rawUrl.split('?')[0]
  if (url === '/docs/collab-token') {
    return { data: { token: 'dev', expiresAt: Date.now() + 300000, role: 'admin', permission_epoch: 1 }, status: 200 }
  }
  const m = url.match(/^\/docs\/([^/]+)$/)
  if (m) return { data: { docId: m[1], title: 'Smoke', ownerId: 'u_smoke', role: 'admin', docType: 'board' }, status: 200 }
  return { data: {}, status: 200 }
}
setWKApp(wk)

// ── realistic RAW elements (plain JSON, as cross-peer / persisted state lands in the Y.Doc) ───
// They carry full geometry but are NOT class instances and lack the fractional `index` /
// normalised fields restoreElements assigns — the state XIN-87 found rendering as points/handles.
function rawScene(): ExcalidrawElement[] {
  const base = {
    angle: 0,
    strokeColor: '#1971c2',
    backgroundColor: '#a5d8ff',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [] as string[],
    frameId: null,
    roundness: null,
    seed: 123456,
    versionNonce: 111,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  }
  const rect = {
    ...base,
    id: 'rect-1',
    type: 'rectangle',
    x: 80,
    y: 80,
    width: 220,
    height: 130,
    version: 1,
  } as unknown as ExcalidrawElement
  const arrow = {
    ...base,
    id: 'arrow-1',
    type: 'arrow',
    x: 80,
    y: 260,
    width: 220,
    height: 60,
    version: 1,
    points: [
      [0, 0],
      [220, 60],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
  } as unknown as ExcalidrawElement
  return [rect, arrow]
}

const REOPEN_DOC = 'smoke-reopen-doc'

function Smoke(): React.ReactElement {
  // Two docs + two production bindings; the wire cross-applies updates with a non-local origin.
  const docA = useRef(new Y.Doc()).current
  const docB = useRef(new Y.Doc()).current
  const bindingA = useRef<ExcalidrawYjsBinding | null>(null)
  const bindingB = useRef<ExcalidrawYjsBinding | null>(null)
  const apiBraw = useRef<{ updateScene: (s: { elements: readonly unknown[] }) => void; getSceneElements?: () => readonly unknown[] } | null>(null)
  const apiBfix = useRef<{ getSceneElementsIncludingDeleted?: () => readonly ExcalidrawElement[] } | null>(null)
  const apiReopen = useRef<{ getSceneElementsIncludingDeleted?: () => readonly ExcalidrawElement[] } | null>(null)
  const bindingR = useRef<ExcalidrawYjsBinding | null>(null)
  const [showReopen, setShowReopen] = useState(false)

  // ── case 7 (cold reopen) — a NEW client whose local mirror is empty: the scene must arrive over
  //    the wire (server/IndexedDB sync) and, crucially, the Y.Doc is populated BEFORE the canvas
  //    mounts (the heavy Excalidraw chunk loads slower than the provider syncs an existing board).
  //    This is the ordering B-fix never exercises (there A seeds AFTER B's canvas + adapter wired).
  const docCold = useRef(new Y.Doc()).current
  const bindingCold = useRef<ExcalidrawYjsBinding | null>(null)
  const apiCold = useRef<{ getSceneElementsIncludingDeleted?: () => readonly ExcalidrawElement[] } | null>(null)
  const [showCold, setShowCold] = useState(false)

  // ── case 6 (reconnect) — B is synced + rendered, the WS drops, A keeps editing, then B
  //    reconnects and the buffered updates replay. B must converge to A's latest state.
  const docRecon = useRef(new Y.Doc()).current
  const bindingRecon = useRef<ExcalidrawYjsBinding | null>(null)
  const apiRecon = useRef<{ getSceneElementsIncludingDeleted?: () => readonly ExcalidrawElement[] } | null>(null)
  const reconConnected = useRef(true)
  const reconBuffer = useRef<Uint8Array[]>([])

  if (!bindingA.current) bindingA.current = new ExcalidrawYjsBinding(docA)
  if (!bindingB.current) {
    bindingB.current = new ExcalidrawYjsBinding(docB)
    // Capture B-fix's imperative api so the smoke can read its applied scene.
    const b = bindingB.current
    const orig = b.setApi.bind(b)
    b.setApi = (api): void => {
      apiBfix.current = api as typeof apiBfix.current
      orig(api as Parameters<typeof orig>[0])
    }
  }
  // Reconnect peer: a third production binding wired to A through a gateable "connection".
  if (!bindingRecon.current) {
    bindingRecon.current = new ExcalidrawYjsBinding(docRecon)
    const r = bindingRecon.current
    const orig = r.setApi.bind(r)
    r.setApi = (api): void => {
      apiRecon.current = api as typeof apiRecon.current
      orig(api as Parameters<typeof orig>[0])
    }
  }
  // Cold-reopen peer: constructed eagerly against an EMPTY doc (as production does — the binding is
  // built with a fresh Y.Doc, then the provider populates it). coldSyncThenMount() applies A's
  // state into docCold (observe fires on the still-null api → no-op) and only then mounts the board.
  if (!bindingCold.current) {
    bindingCold.current = new ExcalidrawYjsBinding(docCold)
    const c = bindingCold.current
    const orig = c.setApi.bind(c)
    c.setApi = (api): void => {
      apiCold.current = api as typeof apiCold.current
      orig(api as Parameters<typeof orig>[0])
    }
  }

  useEffect(() => {
    const onA = (update: Uint8Array, origin: unknown): void => {
      if (origin !== 'wire-b') Y.applyUpdate(docB, update, 'wire-a')
      // Reconnect peer: deliver while connected, otherwise buffer for replay on reconnect — exactly
      // what a dropped WS does (the server queues the diff and the provider syncs it on reconnect).
      if (origin !== 'wire-b') {
        if (reconConnected.current) Y.applyUpdate(docRecon, update, 'provider')
        else reconBuffer.current.push(update)
      }
    }
    const onB = (update: Uint8Array, origin: unknown): void => {
      if (origin !== 'wire-a') Y.applyUpdate(docA, update, 'wire-b')
    }
    docA.on('update', onA)
    docB.on('update', onB)
    return () => {
      docA.off('update', onA)
      docB.off('update', onB)
    }
  }, [docA, docB, docRecon])

  useEffect(() => {
    const smoke = {
      // Author the raw scene on A → flows over the wire to B-fix, and is pushed raw to B-raw.
      seed(): void {
        const els = rawScene()
        bindingA.current!.handleLocalChange(els)
        apiBraw.current?.updateScene({ elements: els })
      },
      // Incremental edit: move the rectangle and bump its version (live-increment path).
      moveRect(): void {
        const [rect, arrow] = rawScene()
        const moved = { ...rect, x: 180, y: 120, version: 2, versionNonce: 222 } as ExcalidrawElement
        bindingA.current!.handleLocalChange([moved, arrow])
      },
      bFixScene(): ExcalidrawElement[] {
        return [...(apiBfix.current?.getSceneElementsIncludingDeleted?.() ?? [])]
      },
      bRawScene(): unknown[] {
        return [...(apiBraw.current?.getSceneElements?.() ?? [])]
      },
      // Reopen case: persist the RAW scene to the local mirror, then mount a fresh board for it.
      prepareReopen(): void {
        persistBoardScene(REOPEN_DOC, { elements: rawScene(), appState: {}, files: {} })
        if (!bindingR.current) {
          const r = new ExcalidrawYjsBinding(new Y.Doc())
          const orig = r.setApi.bind(r)
          r.setApi = (api): void => {
            apiReopen.current = api as typeof apiReopen.current
            orig(api as Parameters<typeof orig>[0])
          }
          bindingR.current = r
        }
        setShowReopen(true)
      },
      reopenScene(): ExcalidrawElement[] {
        return [...(apiReopen.current?.getSceneElementsIncludingDeleted?.() ?? [])]
      },

      // ── case 7 (cold reopen): the production ordering B-fix never exercises. A fresh client's
      //    Y.Doc is synced from the server FIRST (canvas not mounted yet → applyRemote is a no-op
      //    on the null api), then the heavy Excalidraw chunk mounts and setApi/setRenderAdapter
      //    must replay the already-synced doc. Local mirror is empty, so initialData is empty too:
      //    the only path to a non-empty canvas is that replay. We populate docCold from A's current
      //    state, THEN mount the board.
      coldSyncThenMount(): void {
        Y.applyUpdate(docCold, Y.encodeStateAsUpdate(docA), 'provider')
        setShowCold(true)
      },
      coldScene(): ExcalidrawElement[] {
        return [...(apiCold.current?.getSceneElementsIncludingDeleted?.() ?? [])]
      },

      // ── case 6 (reconnect) ──────────────────────────────────────────────────────────────────
      reconDisconnect(): void {
        reconConnected.current = false
      },
      // A makes edits while the recon peer is offline: move the rect (version bump) and add a new
      // element. These buffer until reconnect.
      editWhileReconOffline(): void {
        const [rect, arrow] = rawScene()
        const moved = { ...rect, x: 320, y: 240, version: 5, versionNonce: 555 } as ExcalidrawElement
        const added = {
          ...rect,
          id: 'ellipse-1',
          type: 'ellipse',
          x: 600,
          y: 120,
          width: 140,
          height: 90,
          version: 1,
          versionNonce: 777,
        } as unknown as ExcalidrawElement
        bindingA.current!.handleLocalChange([moved, arrow, added])
      },
      reconReconnect(): void {
        // Replay every buffered update, then resume live delivery — what the provider does on a
        // re-established WS.
        for (const u of reconBuffer.current) Y.applyUpdate(docRecon, u, 'provider')
        reconBuffer.current = []
        reconConnected.current = true
      },
      reconScene(): ExcalidrawElement[] {
        return [...(apiRecon.current?.getSceneElementsIncludingDeleted?.() ?? [])]
      },
    }
    ;(window as unknown as { __smoke: typeof smoke }).__smoke = smoke
  }, [])

  const sessionA = { binding: bindingA.current } as unknown as WhiteboardSession
  const sessionB = { binding: bindingB.current } as unknown as WhiteboardSession
  const sessionRecon = { binding: bindingRecon.current } as unknown as WhiteboardSession

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4 }}>
        <div data-panel="A" style={{ flex: 1, height: 420, border: '1px solid #ccc' }}>
          <div>A (author)</div>
          <div style={{ height: 390 }}>
            <BoardShell docId="smoke-a" title="A" space="demo" collabSession={sessionA} />
          </div>
        </div>
        <div data-panel="Bfix" style={{ flex: 1, height: 420, border: '2px solid #2f9e44' }}>
          <div>B-fix (restore/reconcile)</div>
          <div style={{ height: 390 }}>
            <BoardShell docId="smoke-b" title="Bfix" space="demo" collabSession={sessionB} />
          </div>
        </div>
        <div data-panel="Braw" style={{ flex: 1, height: 420, border: '2px solid #e03131' }}>
          <div>B-raw (no restore — control)</div>
          <div style={{ height: 390 }}>
            <Excalidraw
              excalidrawAPI={(api: unknown) => {
                apiBraw.current = api as typeof apiBraw.current
              }}
            />
          </div>
        </div>
        <div data-panel="Recon" style={{ flex: 1, height: 420, border: '2px solid #f08c00' }}>
          <div>Recon (case 6 reconnect)</div>
          <div style={{ height: 390 }}>
            <BoardShell docId="smoke-recon" title="Recon" space="demo" collabSession={sessionRecon} />
          </div>
        </div>
      </div>
      {showCold && (
        <div data-panel="Cold" style={{ height: 420, border: '2px solid #9c36b5' }}>
          <div>Cold reopen (case 7 — empty mirror, doc synced before mount)</div>
          <div style={{ height: 390 }}>
            <BoardShell
              docId="smoke-cold"
              title="Cold"
              space="demo"
              collabSession={{ binding: bindingCold.current } as unknown as WhiteboardSession}
            />
          </div>
        </div>
      )}
      {showReopen && (
        <div data-panel="Reopen" style={{ height: 420, border: '2px solid #1971c2' }}>
          <div>Reopen (initialData restore)</div>
          <div style={{ height: 390 }}>
            <BoardShell
              docId={REOPEN_DOC}
              title="Reopen"
              space="demo"
              collabSession={{ binding: bindingR.current } as unknown as WhiteboardSession}
            />
          </div>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Smoke />)
