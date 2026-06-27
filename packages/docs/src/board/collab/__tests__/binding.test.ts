// Bidirectional binding loop + anti-self-excitation guards.
//
// Test-matrix coverage (FE design §5.7 / Ken §3.6.3):
//   T1  local create        → Y.Doc                       T6  delete via tombstone
//   T3  remote add          → updateScene                 T8  anti-loop: local write does not echo
//   T4  remote field merge (no clobber of local field)    T9  files: refs only, no binary in Y.Doc
//   T5  concurrent offline edit merge                     T10 external/agent write → render
//   T7  CAS (see reconcile.test.ts) + stale-local reject  M-1 guard counters stay bounded
//                                                          M-9 undo captures local edits only
import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { ExcalidrawYjsBinding, LOCAL_ORIGIN, REPAIR_ORIGIN } from '../binding.ts'
import { readElement } from '../yElement.ts'
import { makeEl, bump, FakeExcalidrawApi, syncDocs } from './helpers.ts'
import type { ExcalidrawElement } from '../types.ts'

function elsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('elements')
}

describe('ExcalidrawYjsBinding', () => {
  let doc: Y.Doc
  let api: FakeExcalidrawApi
  let binding: ExcalidrawYjsBinding

  beforeEach(() => {
    doc = new Y.Doc()
    api = new FakeExcalidrawApi()
    binding = new ExcalidrawYjsBinding(doc, { api })
  })

  it('T1: a local create lands in Y.Map(elements) as a per-element Y.Map', () => {
    binding.handleLocalChange([makeEl('a', { x: 3 })])
    const yEl = elsOf(doc).get('a')
    expect(yEl).toBeInstanceOf(Y.Map)
    expect(yEl!.get('x')).toBe(3)
    expect(binding.__telemetry.localWrites).toBe(1)
  })

  it('T8: a purely local write never bounces back into updateScene (guard 1 = own origin)', () => {
    binding.handleLocalChange([makeEl('a')])
    expect(api.updateSceneCalls).toBe(0) // our own write must not re-render via the remote path
    expect(binding.__telemetry.skippedOwnOrigin).toBeGreaterThanOrEqual(1)
  })

  it('T3 / T10: a remote (or agent) write to the Y.Doc renders via updateScene', () => {
    const peer = new Y.Doc()
    const pe = elsOf(peer)
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('r1', { x: 9 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      pe.set('r1', m)
    })
    syncDocs(peer, doc, 'remote')

    expect(api.updateSceneCalls).toBe(1)
    expect(api.scene.find((e) => e.id === 'r1')?.x).toBe(9)
    expect(binding.__telemetry.remoteApplies).toBe(1)
  })

  it('T4 / T5: concurrent edits to DIFFERENT fields of one element merge losslessly', () => {
    // shared starting point on both peers
    binding.handleLocalChange([makeEl('a', { x: 1, y: 1, version: 1 })])
    const peer = new Y.Doc()
    syncDocs(doc, peer, 'remote')

    // peer edits y (field-level), local edits x — offline, then exchange
    const pe = elsOf(peer)
    peer.transact(() => pe.get('a')!.set('y', 99), 'peerEdit')
    binding.handleLocalChange([makeEl('a', { x: 50, y: 1, version: 2 })])

    syncDocs(peer, doc, 'remote')
    syncDocs(doc, peer, 'remote')

    const merged = readElement(elsOf(doc).get('a')!)
    expect(merged.x).toBe(50) // local field preserved
    expect(merged.y).toBe(99) // remote field preserved — NOT clobbered by a whole-blob LWW
  })

  it('T6: removing an element from the scene writes a tombstone, not a key delete', () => {
    binding.handleLocalChange([makeEl('a', { version: 1 })])
    binding.handleLocalChange([]) // element gone from the canvas
    const yEl = elsOf(doc).get('a')
    expect(yEl).toBeInstanceOf(Y.Map) // key still present
    const back = readElement(yEl!)
    expect(back.isDeleted).toBe(true)
    expect(back.version as number).toBeGreaterThan(1) // version bumped so the delete converges
  })

  it('T7: a stale local edit (lower version than the doc) is rejected by CAS', () => {
    // doc advanced to v5 by a remote write
    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('a', { version: 5, x: 5 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('a', m)
    })
    syncDocs(peer, doc, 'remote')

    // local tries to write v3 (stale) — must be dropped, doc keeps v5
    binding.handleLocalChange([makeEl('a', { version: 3, x: 999 })])
    expect(binding.__telemetry.casRejected).toBeGreaterThanOrEqual(1)
    expect(readElement(elsOf(doc).get('a')!).x).toBe(5)
  })

  it('T8 (guard 3): an onChange triggered DURING a remote apply is short-circuited', () => {
    // make updateScene reentrant: it feeds the applied elements straight back into onChange
    api.onUpdate = (elements) => binding.handleLocalChange(elements)
    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('a', { x: 1 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('a', m)
    })
    syncDocs(peer, doc, 'remote')

    expect(binding.__telemetry.skippedApplyingRemote).toBeGreaterThanOrEqual(1)
    // the reentrant onChange must NOT have produced a local write back to the doc
    expect(binding.__telemetry.localWrites).toBe(0)
  })

  it('guard 4: after applying a remote write, a following identical onChange diffs empty', () => {
    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('a', { x: 7, version: 4 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('a', m)
    })
    syncDocs(peer, doc, 'remote') // binding applied → snapshot resynced to applied state

    const writesBefore = binding.__telemetry.localWrites
    binding.handleLocalChange([...api.scene]) // Excalidraw replays the applied scene
    expect(binding.__telemetry.localWrites).toBe(writesBefore) // nothing written back
    expect(binding.__telemetry.skippedEmptyDiff).toBeGreaterThanOrEqual(1)
  })

  it('T9: image files store reference metadata only — never binary in the Y.Doc', () => {
    const img = makeEl('img1', { type: 'image', fileId: 'f1' })
    binding.handleLocalChange([img], {
      f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 123 },
    })
    const yFile = doc.getMap<Y.Map<unknown>>('files').get('f1')!
    expect(yFile.get('mimeType')).toBe('image/png')
    expect(yFile.get('created')).toBe(123)
    expect(yFile.has('dataURL')).toBe(false) // binary stays out of the Y.Doc (XIN-16 §2.2)
  })

  it('M-1: repeated local+remote cycles keep guard counters bounded (no self-excitation)', () => {
    for (let i = 0; i < 5; i++) {
      binding.handleLocalChange([makeEl('a', { version: i + 1, x: i })])
    }
    // 5 local changes → at most 5 writes, and zero of them re-entered as remote applies
    expect(binding.__telemetry.localWrites).toBeLessThanOrEqual(5)
    expect(binding.__telemetry.remoteApplies).toBe(0)
    expect(api.updateSceneCalls).toBe(0)
  })

  it('M-9: the undo manager captures local edits only, not remote/repair writes', () => {
    binding.handleLocalChange([makeEl('a', { version: 1 })])
    const afterLocal = binding.undoManager!.undoStack.length
    expect(afterLocal).toBeGreaterThanOrEqual(1)

    // a remote write must not grow the local undo stack
    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('b', { version: 1 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('b', m)
    })
    syncDocs(peer, doc, REPAIR_ORIGIN)
    expect(binding.undoManager!.undoStack.length).toBe(afterLocal)
  })

  it('exposes the awareness surface without touching the Y.Doc', () => {
    binding.setAwareness({ selectedElementIds: ['a'], cursor: { x: 1, y: 2 } })
    expect(binding.__awareness.getLocalState().selectedElementIds).toEqual(['a'])
    expect(doc.getMap('elements').size).toBe(0) // presence is not content
  })

  it('writes genuine local edits under LOCAL_ORIGIN', () => {
    const origins: unknown[] = []
    doc.on('afterTransaction', (txn: Y.Transaction) => origins.push(txn.origin))
    binding.handleLocalChange([makeEl('a')])
    expect(origins).toContain(LOCAL_ORIGIN)
  })
})

// Sanity: a deleted element round-trips its tombstone through a real cross-doc sync.
describe('tombstone convergence', () => {
  it('a delete on one peer converges on the other by version', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const ba = new ExcalidrawYjsBinding(a, { api: new FakeExcalidrawApi() })
    ba.handleLocalChange([makeEl('x', { version: 1 })])
    syncDocs(a, b, 'remote')
    ba.handleLocalChange([]) // delete on peer a
    syncDocs(a, b, 'remote')
    const onB = readElement(b.getMap<Y.Map<unknown>>('elements').get('x')!)
    expect(onB.isDeleted).toBe(true)
  })
})

// The render adapter (XIN-87): when the host wires Excalidraw's restore/reconcile contract, a
// remote apply runs restore(remote) → reconcile(local, remote) → updateScene instead of pushing
// raw Y.Doc elements straight to the canvas (which painted them as points/handles). Without an
// adapter the default raw path is unchanged — that is the path every test above exercises.
describe('render adapter — restore → reconcile → updateScene (XIN-87)', () => {
  it('runs restore then reconcile, and applies the reconciled scene', () => {
    const doc = new Y.Doc()
    const api = new FakeExcalidrawApi()
    const binding = new ExcalidrawYjsBinding(doc, { api })

    const order: string[] = []
    binding.setRenderAdapter({
      restore: (remote) => {
        order.push('restore')
        // Stand in for Excalidraw rehydration: tag each element as restored.
        return remote.map((e) => ({ ...e, restored: true }))
      },
      reconcile: (local, restoredRemote) => {
        order.push('reconcile')
        // Restore must have run first — the remote it receives is already rehydrated.
        expect(restoredRemote.every((e) => (e as Record<string, unknown>).restored === true)).toBe(true)
        return [...local, ...restoredRemote]
      },
    })

    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('r1', { x: 5 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('r1', m)
    })
    syncDocs(peer, doc, 'remote')

    expect(order).toEqual(['restore', 'reconcile'])
    const applied = api.scene.find((e) => e.id === 'r1')
    expect(applied).toBeDefined()
    expect((applied as Record<string, unknown>).restored).toBe(true) // restored shape reached the canvas
    expect(binding.__telemetry.remoteApplies).toBe(1)
  })

  it('re-applies the current doc through the contract the moment the adapter is wired', () => {
    const doc = new Y.Doc()
    const api = new FakeExcalidrawApi()
    const binding = new ExcalidrawYjsBinding(doc, { api })

    // A remote element arrives and is applied RAW (no adapter yet) — the points/handles state.
    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('r1', { x: 5 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('r1', m)
    })
    syncDocs(peer, doc, 'remote')
    expect((api.scene.find((e) => e.id === 'r1') as Record<string, unknown>).restored).toBeUndefined()

    // Wiring the adapter (BoardShell does this once Excalidraw loads) re-renders through restore.
    binding.setRenderAdapter({
      restore: (remote) => remote.map((e) => ({ ...e, restored: true })),
      reconcile: (_local, restoredRemote) => [...restoredRemote],
    })
    expect((api.scene.find((e) => e.id === 'r1') as Record<string, unknown>).restored).toBe(true)
  })
})

// normalized for local render before updateScene, never written back to the Y.Doc.
describe('merge-time repair pass renders a self-consistent scene (M-2/M-3/M-8)', () => {
  function seed(doc: Y.Doc, id: string, fields: Record<string, unknown>): void {
    doc.transact(() => {
      const m = new Y.Map<unknown>()
      for (const [k, v] of Object.entries({ id, version: 1, versionNonce: 1, ...fields })) m.set(k, v)
      elsOf(doc).set(id, m as Y.Map<unknown>)
    }, 'seed')
  }

  it('M-8 / M-3: a remote write with dangling boundElements + frameId renders pruned', () => {
    const doc = new Y.Doc()
    const api = new FakeExcalidrawApi()
    new ExcalidrawYjsBinding(doc, { api })
    const peer = new Y.Doc()
    seed(peer, 'shape', {
      type: 'rectangle',
      boundElements: [{ id: 'ghost', type: 'arrow' }],
      frameId: 'gone',
    })
    syncDocs(peer, doc, 'remote')

    const shape = api.scene.find((e) => e.id === 'shape')!
    expect(shape.boundElements).toEqual([]) // dangling entry pruned (M-8)
    expect(shape.frameId).toBeNull() // dangling frame cleared (M-3)
    // repair is render-only: the Y.Doc still holds the un-repaired element (BE is the writer)
    expect(readElement(elsOf(doc).get('shape')!).frameId).toBe('gone')
  })

  it('M-2: a remote image with a dangling fileId is not rendered', () => {
    const doc = new Y.Doc()
    const api = new FakeExcalidrawApi()
    new ExcalidrawYjsBinding(doc, { api })
    const peer = new Y.Doc()
    seed(peer, 'img', { type: 'image', fileId: 'gone' })
    syncDocs(peer, doc, 'remote')
    expect(api.scene.find((e) => e.id === 'img')).toBeUndefined()
  })
})

