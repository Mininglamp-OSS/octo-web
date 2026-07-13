// Real-browser presence smoke (XIN-115). Companion to dev/smoke.collab.tsx.
//
// XIN-111 made presence_delta=1 at the DATA layer (readBoardCollaborators), and the node suite
// passed — but real two-browser case8 still showed presence_delta=0 (XIN-114). Reason: in
// @excalidraw/excalidraw 0.18.1 the `collaborators` PROP is inert — the wrapper never forwards it to
// the canvas, so nothing renders unless presence is pushed via the imperative api.updateScene({
// collaborators }). node/jsdom can't import Excalidraw, so only a real renderer reproduces it.
//
// This harness mounts TWO production BoardShell instances with their own real y-protocols Awareness,
// and bridges the two awareness channels exactly the way HocuspocusProvider relays them over the WS
// (encodeAwarenessUpdate → applyAwarenessUpdate, incrementally on every update). No collab backend is
// needed — the wire is simulated, same approach smoke.collab.tsx uses for the Y.Doc. Dev-only.

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { setWKApp } from '../src/octoweb/index.ts'
import { createMockWKApp } from '../src/octoweb/mock.ts'
import { BoardShell } from '../src/board/BoardShell.tsx'
import { ExcalidrawYjsBinding } from '../src/board/collab/index.ts'
import type { WhiteboardSession } from '../src/board/collab/index.ts'
import { presenceDelta, readBoardCollaborators } from '../src/board/collab/presence.ts'

const BOARD = 'presence-smoke'

// Mock backend so BoardShell's getDoc resolves an editable (admin) board.
const wk = createMockWKApp({ uid: 'u_presence', token: 'dev-token' })
wk.apiClient.responder = (_method, rawUrl) => {
  const url = rawUrl.split('?')[0]
  if (url === '/docs/collab-token') {
    return { data: { token: 'dev', expiresAt: Date.now() + 300000, role: 'admin', permission_epoch: 1 }, status: 200 }
  }
  const m = url.match(/^\/docs\/([^/]+)$/)
  if (m) return { data: { docId: m[1], title: 'Presence', ownerId: 'u_presence', role: 'admin', docType: 'board' }, status: 200 }
  return { data: {}, status: 200 }
}
setWKApp(wk)

/** Relay `from`'s awareness into `to`, like HocuspocusProvider does over the WS: a full-state sync
 *  on connect (so a peer already present is seen immediately) plus incremental updates after. */
function bridge(from: Awareness, to: Awareness): () => void {
  const onUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changed = [...added, ...updated, ...removed]
    applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), 'remote')
  }
  const initial = Array.from(from.getStates().keys())
  if (initial.length) applyAwarenessUpdate(to, encodeAwarenessUpdate(from, initial), 'remote')
  from.on('update', onUpdate)
  return () => from.off('update', onUpdate)
}

/** Minimal session shape BoardShell consumes: a real binding + a provider exposing real awareness. */
function makeSession(awareness: Awareness, ydoc: Y.Doc): WhiteboardSession {
  return {
    provider: { awareness, status: 'connected', synced: true },
    binding: new ExcalidrawYjsBinding(ydoc),
  } as unknown as WhiteboardSession
}

function Presence(): React.ReactElement {
  const docA = useRef(new Y.Doc()).current
  const docB = useRef(new Y.Doc()).current
  const awA = useRef(new Awareness(docA)).current
  const awB = useRef(new Awareness(docB)).current
  const sessionA = useRef(makeSession(awA, docA)).current
  const sessionB = useRef(makeSession(awB, docB)).current

  useEffect(() => {
    const offA = bridge(awA, awB)
    const offB = bridge(awB, awA)
    const probe = {
      deltaA: () => presenceDelta(awA),
      deltaB: () => presenceDelta(awB),
      collabB: () => Object.fromEntries(readBoardCollaborators(awB)),
    }
    ;(window as unknown as { __presence: typeof probe }).__presence = probe
    return () => {
      offA()
      offB()
    }
  }, [awA, awB])

  return (
    <div style={{ display: 'flex', gap: 4, height: '100%' }}>
      <div data-panel="A" style={{ flex: 1, height: '100vh', border: '2px solid #2f9e44' }}>
        <div>A = Alice</div>
        <div style={{ height: 'calc(100vh - 24px)' }}>
          <BoardShell docId={BOARD} title="A" space="demo" collabSession={sessionA} user={{ id: 'wbtest_a', name: 'Alice' }} />
        </div>
      </div>
      <div data-panel="B" style={{ flex: 1, height: '100vh', border: '2px solid #1971c2' }}>
        <div>B = Bob</div>
        <div style={{ height: 'calc(100vh - 24px)' }}>
          <BoardShell docId={BOARD} title="B" space="demo" collabSession={sessionB} user={{ id: 'wbtest_b', name: 'Bob' }} />
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Presence />)
