// XIN-85 DECISIVE binding trace — single rectangle A→B, instrumented per hop (XIN-82 discipline).
//
// XIN-80 round-5: WS frames are received on B (received>0) but A's rectangle never reaches B's
// canvas. The pure-logic binding tests (binding.test.ts) pass because they hand the imperative
// Excalidraw API to the binding at CONSTRUCTION time. Reality differs: BoardShell loads Excalidraw
// with a client-only dynamic import, so the canvas mounts (and `setApi` is called) LATE — after the
// HocuspocusProvider has already synced the existing doc state. These tests reproduce that ordering
// and log every hop on B so we can see exactly where the rectangle disappears.

import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { ExcalidrawYjsBinding } from '../binding.ts'
import { repairForRender } from '../repair.ts'
import { readAllElements } from '../yElement.ts'
import { makeEl, FakeExcalidrawApi, syncDocs } from './helpers.ts'

function elsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('elements')
}

/** Author a single rectangle on peer A exactly as the binding's local write path would. */
function peerDrawsRectangle(): Y.Doc {
  const a = new Y.Doc()
  const apiA = new FakeExcalidrawApi()
  const bindingA = new ExcalidrawYjsBinding(a, { api: apiA })
  bindingA.handleLocalChange([makeEl('rect-1', { x: 12, y: 34, width: 50, height: 60 })])
  return a
}

describe('XIN-85 trace: A draws one rectangle, hop-by-hop on B', () => {
  it('REAL ordering (canvas mounts AFTER provider sync): the late setApi replays the synced rectangle onto B', () => {
    const hops: string[] = []

    // B's session: provider + binding are built first; the Excalidraw API is NOT attached yet,
    // because the canvas chunk is still loading (BoardShell dynamic import).
    const b = new Y.Doc()
    const binding = new ExcalidrawYjsBinding(b /* no api */)

    const a = peerDrawsRectangle()

    // ── hop 1: WS provider receives a frame ────────────────────────────────────────────────────
    const update = Y.encodeStateAsUpdate(a)
    hops.push(`hop1 provider.received bytes=${update.byteLength}`)
    expect(update.byteLength).toBeGreaterThan(0)

    // ── hop 2: provider applies the update into B's Y.Doc (origin = provider, NOT local) ────────
    Y.applyUpdate(b, update, 'provider')
    const docCount = elsOf(b).size
    hops.push(`hop2 ydoc.applied elements.size=${docCount}`)
    expect(docCount).toBe(1) // the rectangle DID land in B's Y.Doc

    // ── hop 3: the binding's observeDeep fired (remoteApplies counter advanced) ──────────────────
    hops.push(`hop3 observer.fired remoteApplies=${binding.__telemetry.remoteApplies}`)
    expect(binding.__telemetry.remoteApplies).toBe(1) // observer DID fire

    // ── hop 4: repair input/output element count for this scene ──────────────────────────────────
    const rawEls = readAllElements(elsOf(b))
    const repaired = repairForRender(rawEls, new Set(b.getMap('files').keys() as Iterable<string>))
    hops.push(`hop4 repair in=${rawEls.length} out=${repaired.length}`)
    expect(repaired.length).toBe(1) // repair did NOT eat the rectangle — it survives normalize

    // ── hop 5: origin filter — the remote txn was NOT mistaken for our own local echo ───────────
    hops.push(`hop5 origin.skippedOwnOrigin=${binding.__telemetry.skippedOwnOrigin}`)
    expect(binding.__telemetry.skippedOwnOrigin).toBe(0) // not filtered as a local echo

    // ── hop 6: updateScene — when applyRemote first ran the canvas had NO api, so the call was a
    //          silent no-op (this.api?.updateScene with api === null). The canvas now mounts; the
    //          fixed setApi replays the already-synced doc so B catches up (XIN-85). ─────────────
    const api = new FakeExcalidrawApi()
    binding.setApi(api) // BoardShell.handleApi → setApi, fired when Excalidraw finally mounts

    hops.push(`hop6 updateScene.callsAfterMount=${api.updateSceneCalls} sceneAfterMount=${api.scene.length}`)

    // eslint-disable-next-line no-console
    console.log('\n[XIN-85 trace · REAL ordering, fixed]\n' + hops.join('\n') + '\n')

    // Before the fix the rectangle was in B's Y.Doc and survived repair, the observer fired and
    // even counted a "remote apply" — but updateScene was called on a null api, so nothing reached
    // the canvas and setApi never replayed it. After the fix, the late setApi replays the doc.
    expect(api.scene.find((e) => e.id === 'rect-1')?.x).toBe(12) // ← rectangle now renders on B
  })

  it('CONTROL (api present at apply time): the same rectangle renders — proves the logic is sound', () => {
    const b = new Y.Doc()
    const api = new FakeExcalidrawApi()
    new ExcalidrawYjsBinding(b, { api }) // api attached up front (the binding.test.ts assumption)

    const a = peerDrawsRectangle()
    syncDocs(a, b, 'provider')

    expect(api.scene.find((e) => e.id === 'rect-1')?.x).toBe(12) // renders fine when api is present
  })

  it('FIX behaviour: refreshFromDoc() after a late setApi replays the synced doc onto the canvas', () => {
    const b = new Y.Doc()
    const binding = new ExcalidrawYjsBinding(b /* no api */)

    const a = peerDrawsRectangle()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'provider') // synced before the canvas exists

    const api = new FakeExcalidrawApi()
    binding.setApi(api)
    binding.refreshFromDoc() // ← the catch-up call BoardShell currently never makes

    expect(api.scene.find((e) => e.id === 'rect-1')?.x).toBe(12) // now it renders
  })

  it('setApi guard: a late setApi on an EMPTY doc does not push a scene (fresh board keeps its local initialData)', () => {
    // A brand-new board: nothing synced yet (provider connected, doc still empty). The canvas
    // mounts with local `initialData`; setApi must NOT call updateScene([]) and wipe it before the
    // first onChange has seeded the doc.
    const b = new Y.Doc()
    const binding = new ExcalidrawYjsBinding(b /* no api */)
    const api = new FakeExcalidrawApi()
    binding.setApi(api)
    expect(api.updateSceneCalls).toBe(0) // empty doc → no replay → fresh canvas untouched
  })
})
