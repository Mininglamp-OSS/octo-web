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

  it('XIN-80: an in-place geometry update after the 0-size create propagates to the Y.Doc', () => {
    // Real Excalidraw mutates element objects IN PLACE: `mutateElement` reassigns width/height/
    // points and bumps version on the SAME object, then hands those same references to onChange.
    // The local diff snapshot must copy by value, or `prev` and `el` are the same reference and
    // jsonEqual short-circuits on `a === b` — the diff sees no change and the real geometry never
    // reaches the Y.Doc (the XIN-80 3-point diff: only the 0-size create was written). A synthetic
    // applyUpdate repro can't surface this because makeEl/bump return fresh objects each call.
    const live = makeEl('rect', { width: 0, height: 0, version: 1 })
    binding.handleLocalChange([live]) // pointer-down: element created at 0 size
    expect(elsOf(doc).get('rect')!.get('width')).toBe(0)

    // pointer-move/up: the user drags it out to a real size — Excalidraw mutates the SAME object.
    const m = live as unknown as Record<string, number>
    m.width = 120
    m.height = 80
    m.version = 2
    m.versionNonce = 4242
    binding.handleLocalChange([live]) // onChange re-emits the same, now-mutated reference

    const yEl = elsOf(doc).get('rect')!
    expect(yEl.get('width')).toBe(120) // real geometry reached the Y.Doc, not the 0-size initial
    expect(yEl.get('height')).toBe(80)
    expect(yEl.get('version')).toBe(2)
  })

  it('XIN-80/XIN-93: a multi-tick drag mirroring Excalidraw mutateElement lands real w/h, not 0x0 v2', () => {
    // Faithful to @excalidraw/excalidraw@0.18.1 `mutateElement`: it mutates the SAME object in
    // place and runs `element.version++; element.versionNonce = randomInteger()` on EVERY field
    // change. So a drag-create emits the same reference through onChange at strictly increasing
    // versions. XIN-93 observed the Y.Doc frozen at "v2 0x0": pre-fix, the first onChange the
    // binding captured was written, then every later higher-version real-geometry onChange was
    // diffed away (prev === el → jsonEqual short-circuits). This reproduces that exact drag and
    // asserts the post-fix Y.Doc holds the final real geometry at the latest version — and, because
    // version is monotonic per mutateElement, CAS never rejects the later update (no same-version
    // edge case), so the diff fix alone is sufficient.
    const live = makeEl('rect', { width: 0, height: 0, version: 1 })
    const mutate = (updates: Record<string, number>): void => {
      const obj = live as unknown as Record<string, number>
      for (const k of Object.keys(updates)) obj[k] = updates[k]
      obj.version++ // mutateElement bumps version on every change
      obj.versionNonce = (obj.versionNonce % 9973) + 17 // a fresh nonce each tick (value irrelevant)
    }

    binding.handleLocalChange([live]) // pointerdown commits the element at 0x0 (v1)
    mutate({ x: 5 }) // a non-geometry change still bumps the version → first captured state is v2, 0x0
    binding.handleLocalChange([live])
    expect(elsOf(doc).get('rect')!.get('width')).toBe(0) // matches XIN-93's "v2 0x0" starting point

    mutate({ width: 40, height: 25 }) // pointermove ticks fill the real size at v3, v4, …
    binding.handleLocalChange([live])
    mutate({ width: 160, height: 90 })
    binding.handleLocalChange([live]) // pointerup: final geometry

    const yEl = elsOf(doc).get('rect')!
    expect(yEl.get('width')).toBe(160) // final real geometry landed, not the frozen 0x0 v2
    expect(yEl.get('height')).toBe(90)
    expect(yEl.get('version')).toBe(4)
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

  it('T4 / T5: per-field Yjs merge keeps a peer field write when it is not CAS-gated (not whole-blob LWW)', () => {
    // shared starting point on both peers
    binding.handleLocalChange([makeEl('a', { x: 1, y: 1, version: 1 })])
    const peer = new Y.Doc()
    syncDocs(doc, peer, 'remote')

    // Peer edits `y` as a direct Y.Map field write (NOT through the binding's whole-element CAS),
    // local edits `x` through the binding — offline, then exchange. Because the peer's write is a
    // per-field Yjs op, it is not subject to the whole-element CAS and both fields survive the
    // merge. (This is the per-field-storage benefit; it is NOT a general lossless guarantee — two
    // concurrent CAS-gated local writes on the same element still resolve last-writer-wins, P1-5.)
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

  it('XIN-96: a remote-rendered element that vanishes from an onChange is NOT tombstoned (reinit, not a delete)', () => {
    // A remote peer's element syncs in and renders onto the canvas — the binding never saw it as a
    // local edit (locallyAuthored stays empty), exactly like a cold reopen / reconnect restore.
    const peer = new Y.Doc()
    const remote = new ExcalidrawYjsBinding(peer, { api: new FakeExcalidrawApi() })
    remote.handleLocalChange([makeEl('r', { x: 7, version: 1 })])
    syncDocs(peer, doc, 'remote') // → observe → applyRemote on `binding`; 'r' is now on the canvas
    expect(readElement(elsOf(doc).get('r')!).isDeleted).toBeFalsy()

    // The canvas reinitialises (cold reopen / reconnect / remount) and fires an onChange with the
    // element absent. Excalidraw reports a genuine delete as a PRESENT `isDeleted: true` element
    // (see T6), so an absent remote element is a reinit — tombstoning it would wipe the synced
    // scene (the reopen-replays-empty / reconnect-loses-state symptom).
    binding.handleLocalChange([])

    expect(readElement(elsOf(doc).get('r')!).isDeleted).toBeFalsy() // survived — not wrongly deleted
    expect(binding.__telemetry.skippedReinitDrop).toBeGreaterThanOrEqual(1)
  })

  it('XIN-96 (touched-remote): editing a remote element then losing it to a reinit onChange does NOT tombstone it', () => {
    // The gap the round-4 P0 flags. XIN-96 (above) only covers a remote element the local user NEVER
    // touched. But a genuine onChange that moves / recolours a remote element adds its id to
    // `locallyAuthored` — and pre-fix that made the element permanently tombstone-eligible. A single
    // same-instance reinit onChange (reconnect / remount / reconnect-reset — the triggers the binding
    // comments itself list) then reported it absent with applyingRemote=false and synthesised a
    // tombstone, deleting a LIVE element for every collaborator. The remote-origin guard fixes it:
    // an id that ever arrived from the doc is never tombstoned by bare absence, even after a local edit.
    const peer = new Y.Doc()
    const remote = new ExcalidrawYjsBinding(peer, { api: new FakeExcalidrawApi() })
    remote.handleLocalChange([makeEl('r', { x: 7, version: 1 })])
    syncDocs(peer, doc, 'remote') // → applyRemote on `binding`; 'r' rendered onto the canvas
    expect(readElement(elsOf(doc).get('r')!).isDeleted).toBeFalsy()

    // The local user nudges the remote element once (a move) — a real, present onChange. This is the
    // step that put 'r' into `locallyAuthored` and armed the pre-fix mis-delete.
    binding.handleLocalChange([makeEl('r', { x: 42, version: 2 })])
    expect(readElement(elsOf(doc).get('r')!).x).toBe(42) // the local edit landed
    expect(readElement(elsOf(doc).get('r')!).isDeleted).toBeFalsy()

    // A same-instance reinit (reconnect / remount) fires an onChange with 'r' absent. Because 'r' is
    // remote-origin it must be PRESERVED, not tombstoned — this is exactly the vanished-canvas class
    // XIN-96 exists to prevent, now closed for the touched-remote case too.
    binding.handleLocalChange([])

    expect(readElement(elsOf(doc).get('r')!).isDeleted).toBeFalsy() // survived the reinit — not deleted
    expect(binding.__telemetry.skippedReinitDrop).toBeGreaterThanOrEqual(1)
  })

  it('XIN-98: a reinit onChange that drops a preserved remote element repaints it back onto the canvas', () => {
    // The render half of XIN-96. A remote element syncs in and renders; XIN-96 keeps it in the doc
    // when a reinit onChange reports it absent — but the data surviving is not enough: on a real
    // reconnect / cold reopen the canvas was just repainted WITHOUT it, so it is visually gone. The
    // drop arrived on a LOCAL onChange (no Y.Doc change), so no observe→applyRemote follows; the
    // binding must repaint the authoritative doc itself or the element never paints back.
    const peer = new Y.Doc()
    const remote = new ExcalidrawYjsBinding(peer, { api: new FakeExcalidrawApi() })
    remote.handleLocalChange([makeEl('r', { x: 7, version: 1 })])
    syncDocs(peer, doc, 'remote') // → applyRemote on `binding`; 'r' painted onto the canvas
    expect(api.scene.find((e) => e.id === 'r')).toBeDefined()

    const repaintsBefore = binding.__telemetry.reinitRepaints
    // Model the real canvas reinit: Excalidraw mounts a fresh scene WITHOUT the remote element and
    // fires the onChange that reports it absent.
    api.scene = []
    binding.handleLocalChange([])

    // The element is repainted back from the authoritative doc — visually restored, not just kept.
    expect(api.scene.find((e) => e.id === 'r')).toBeDefined()
    expect(binding.__telemetry.reinitRepaints).toBe(repaintsBefore + 1)
    // And it was NOT tombstoned in the process (the XIN-96 data layer still holds).
    expect(readElement(elsOf(doc).get('r')!).isDeleted).toBeFalsy()
  })

  it('XIN-98: a genuine local delete does NOT trigger a reinit repaint (scope guard)', () => {
    // The repaint must fire ONLY for preserved remote drops, never for a real user delete — a delete
    // is tombstoned and converges over the wire; repainting it back would resurrect deleted shapes.
    binding.handleLocalChange([makeEl('a', { version: 1 })]) // locally authored
    const repaintsBefore = binding.__telemetry.reinitRepaints
    binding.handleLocalChange([]) // user deletes it → tombstone, not a reinit drop
    expect(binding.__telemetry.reinitRepaints).toBe(repaintsBefore) // no repaint
    expect(readElement(elsOf(doc).get('a')!).isDeleted).toBe(true) // tombstoned as before
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

  it('P1-2: a scalar stored under an element key is dropped, not fatal to the whole apply (denial-of-render)', () => {
    // A malicious/buggy peer stores a NON-Y.Map value under an element key alongside a valid one, in
    // the SAME remote transaction that first renders the valid element. A Yjs update is not
    // runtime-typed, so readAllElements → readElement previously threw on the scalar and aborted the
    // entire applyRemote → the valid 'good' element never reached the canvas (blank board). The
    // guard drops the bad entry so 'good' still renders.
    doc.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('good', { x: 7 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(doc).set('good', m)
      // Scalar under an element key — the untrusted-input case.
      ;(elsOf(doc) as unknown as Y.Map<unknown>).set('bad', 123)
    }, 'remote')

    expect(api.scene.find((e) => e.id === 'good')?.x).toBe(7) // valid peer element still rendered
    expect(api.scene.find((e) => e.id === 'bad')).toBeUndefined() // malformed entry dropped
    expect(binding.__telemetry.remoteApplyErrors).toBe(0) // guard drops the entry; no batch abort
  })

  it('P2: a CAS-rejected local edit resyncs its snapshot baseline to the authoritative doc value', () => {
    // doc advanced to v5 by a remote write; the binding applied it and snapshotted v5.
    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('a', { version: 5, x: 5 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('a', m)
    })
    syncDocs(peer, doc, 'remote')

    // A stale local edit (v3) loses the CAS. Before the fix, lastKnown was replaced with THIS losing
    // local element — so re-emitting the same stale edit diffed EMPTY (it matched the stale baseline)
    // and never reached CAS again, leaving a window where the baseline disagreed with the doc. The
    // fix resyncs the rejected id's baseline back to the authoritative doc value.
    binding.handleLocalChange([makeEl('a', { version: 3, x: 999 })])
    const rejectedOnce = binding.__telemetry.casRejected
    expect(rejectedOnce).toBeGreaterThanOrEqual(1)
    expect(binding.__telemetry.casResynced).toBeGreaterThanOrEqual(1)

    // Re-emit the identical stale edit. Because the baseline was resynced to the doc's v5 (not left
    // at the losing v3), this is a genuine diff again and hits CAS again — proving the baseline no
    // longer holds the losing local state. Pre-fix this diffed empty and casRejected stayed flat.
    binding.handleLocalChange([makeEl('a', { version: 3, x: 999 })])
    expect(binding.__telemetry.casRejected).toBeGreaterThan(rejectedOnce)
    // The authoritative doc value is untouched throughout.
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

  it('T9: image files store the canonical ref (attachId/mimeType/status), never binary', async () => {
    // With the object-store bridge wired, an insert uploads the binary and stores ONLY the canonical
    // FileRef the shared schema defines ({attachId, mimeType, status, createdAt}) — never the dataURL.
    binding.setFileSync({ uploader: async () => 'att-9' })
    const img = makeEl('img1', { type: 'image', fileId: 'f1' })
    binding.handleLocalChange([img], {
      f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 123 },
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    const yFile = doc.getMap<Y.Map<unknown>>('files').get('f1')!
    expect(yFile.get('attachId')).toBe('att-9')
    expect(yFile.get('mimeType')).toBe('image/png')
    expect(yFile.get('status')).toBe('saved')
    expect(yFile.get('createdAt')).toBe(123)
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

// XIN-80 acceptance at the node level: A draws a full rectangle the way real Excalidraw drives it
// (create at 0 size, then mutate the SAME object as the user drags) and B must receive the COMPLETE
// geometry over a real cross-doc sync — not the 0-size initial. The browser smoke (A→B render +
// reopen non-zero) is the end-to-end gate; this pins the binding contract underneath it.
describe('XIN-80: A-side in-place draw propagates full geometry to peer B', () => {
  it('B receives the dragged-out size, not the 0-size create', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    const apiB = new FakeExcalidrawApi()
    new ExcalidrawYjsBinding(b, { api: apiB }) // peer B renders remote writes via updateScene

    const ba = new ExcalidrawYjsBinding(a, { api: new FakeExcalidrawApi() })
    const live = makeEl('rect', { width: 0, height: 0, version: 1 })
    ba.handleLocalChange([live]) // pointer-down: created at 0 size

    const m = live as unknown as Record<string, number>
    m.width = 200
    m.height = 140
    m.version = 2
    m.versionNonce = 555
    ba.handleLocalChange([live]) // drag-out: SAME mutated reference Excalidraw re-emits

    syncDocs(a, b, 'remote')
    const renderedOnB = apiB.scene.find((e) => e.id === 'rect')!
    expect(renderedOnB.width).toBe(200) // B paints the full shape, not a 0-size point
    expect(renderedOnB.height).toBe(140)
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

// H1 (XIN-85 / reopen-empty): applyRemote must never push an empty scene. A size>0 guard (aligned
// with the one setApi already applies) stops a non-local empty transaction from calling
// updateScene([]) and wiping a canvas the local mirror just seeded.
describe('empty-apply guard — never updateScene([]) (H1 / XIN-85)', () => {
  it('refreshFromDoc on an empty doc does not touch the canvas', () => {
    const doc = new Y.Doc()
    const api = new FakeExcalidrawApi()
    const binding = new ExcalidrawYjsBinding(doc, { api })
    binding.refreshFromDoc()
    expect(api.updateSceneCalls).toBe(0)
    expect(binding.__telemetry.skippedEmptyApply).toBeGreaterThanOrEqual(1)
    expect(binding.__telemetry.remoteApplies).toBe(0)
  })

  it('a remote transaction that empties the doc does NOT wipe the canvas', () => {
    const doc = new Y.Doc()
    const api = new FakeExcalidrawApi()
    const binding = new ExcalidrawYjsBinding(doc, { api })

    // A remote element arrives and renders.
    const peer = new Y.Doc()
    peer.transact(() => {
      const m = new Y.Map<unknown>()
      const el = makeEl('a', { x: 1 })
      for (const [k, v] of Object.entries(el)) m.set(k, v as unknown)
      elsOf(peer).set('a', m)
    })
    syncDocs(peer, doc, 'remote')
    expect(api.updateSceneCalls).toBe(1)
    expect(api.scene.find((e) => e.id === 'a')).toBeDefined()

    // A foreign clear removes the key (size → 0). The guard must skip rather than render [].
    const callsBefore = api.updateSceneCalls
    doc.transact(() => elsOf(doc).delete('a'), 'remote-clear')
    expect(api.updateSceneCalls).toBe(callsBefore) // no updateScene([]) — canvas untouched
    expect(api.scene.find((e) => e.id === 'a')).toBeDefined() // last good scene preserved
    expect(binding.__telemetry.skippedEmptyApply).toBeGreaterThanOrEqual(1)
  })
})

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

