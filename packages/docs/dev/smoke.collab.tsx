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

  useEffect(() => {
    const onA = (update: Uint8Array, origin: unknown): void => {
      if (origin !== 'wire-b') Y.applyUpdate(docB, update, 'wire-a')
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
  }, [docA, docB])

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
    }
    ;(window as unknown as { __smoke: typeof smoke }).__smoke = smoke
  }, [])

  const sessionA = { binding: bindingA.current } as unknown as WhiteboardSession
  const sessionB = { binding: bindingB.current } as unknown as WhiteboardSession

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
      </div>
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
