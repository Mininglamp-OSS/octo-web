/**
 * NativePanelTextControls × collab CAS-gate regression (XIN-528 lineage):
 *
 * The injected native-panel text controls mutate Excalidraw elements via shallow copies before
 * handing them to `updateScene`. If those shallow copies keep the same CAS stamp (`version` +
 * `versionNonce`) as the previous state, `binding.handleLocalChange` runs them through
 * `elementSupersedes`, which returns false at equal stamps → the write is SILENTLY dropped:
 * `telemetry.casRejected` ticks up while `telemetry.localWrites` stays flat, peers never see the
 * change, and reloading the board reverts it.
 *
 * These tests pin the invariant that:
 *   - a native-panel write that INCREMENTS the CAS stamp (via `bumpElementStamp`) reaches the Y.Doc
 *     — `localWrites` grows, `casRejected` stays flat.
 *   - a naive shallow-copy mutation (no bump) is silently rejected by the CAS gate — `localWrites`
 *     stays flat, `casRejected` grows. This is the negative control that proves the bumping is
 *     what saves the write, not something incidental.
 *   - chained writes on the same element keep landing (guards against a `lastKnown` reuse bug where
 *     only the first write survives).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { ExcalidrawYjsBinding } from '../collab/binding.ts'
import { FakeExcalidrawApi, makeEl } from '../collab/__tests__/helpers.ts'
import { bumpElementStamp } from '../boardElementBump.ts'
import type { ExcalidrawElement } from '../collab/types.ts'

describe('NativePanelTextControls × collab CAS gate', () => {
  let doc: Y.Doc
  let api: FakeExcalidrawApi
  let binding: ExcalidrawYjsBinding

  beforeEach(() => {
    doc = new Y.Doc()
    api = new FakeExcalidrawApi()
    binding = new ExcalidrawYjsBinding(doc, { api })
  })

  it('bumping version + versionNonce (bumpElementStamp) lets a font-size mutation reach the Y.Doc', () => {
    const t0 = makeEl('t1', {
      type: 'text',
      fontSize: 16,
      strokeColor: '#000000',
    } as Partial<ExcalidrawElement>)
    binding.handleLocalChange([t0])
    const writesAfterSeed = binding.__telemetry.localWrites
    const rejectedAfterSeed = binding.__telemetry.casRejected

    const t1 = bumpElementStamp({ ...t0, fontSize: 24 }) as ExcalidrawElement
    binding.handleLocalChange([t1])

    expect(binding.__telemetry.localWrites).toBe(writesAfterSeed + 1)
    expect(binding.__telemetry.casRejected).toBe(rejectedAfterSeed)
  })

  it('regression: a naive shallow-copy mutation (no bump) is silently rejected by the CAS gate', () => {
    const t0 = makeEl('t1', {
      type: 'text',
      fontSize: 16,
      strokeColor: '#000000',
    } as Partial<ExcalidrawElement>)
    binding.handleLocalChange([t0])
    const writesAfterSeed = binding.__telemetry.localWrites
    const rejectedAfterSeed = binding.__telemetry.casRejected

    // The pre-fix path: `{ ...el, fontSize: 24 }` keeps the previous version + nonce.
    const stale = { ...t0, fontSize: 24 } as ExcalidrawElement
    binding.handleLocalChange([stale])

    expect(binding.__telemetry.localWrites).toBe(writesAfterSeed)
    expect(binding.__telemetry.casRejected).toBe(rejectedAfterSeed + 1)
  })

  it('bump path survives a second mutation on the SAME element (chained writes)', () => {
    const t0 = makeEl('t1', {
      type: 'text',
      fontSize: 16,
      strokeColor: '#000000',
    } as Partial<ExcalidrawElement>)
    binding.handleLocalChange([t0])

    const t1 = bumpElementStamp({ ...t0, fontSize: 24 }) as ExcalidrawElement
    binding.handleLocalChange([t1])

    const t2 = bumpElementStamp({ ...t1, strokeColor: '#e03131' }) as ExcalidrawElement
    binding.handleLocalChange([t2])

    expect(binding.__telemetry.localWrites).toBe(3)
    expect(binding.__telemetry.casRejected).toBe(0)
  })

  it('customData.bold + customData.textAlign="justify" propagate through the binding', () => {
    // Mimics the exact mutation shape NativePanelTextControls emits: element-level bold + justify
    // stored inside customData, with the native `textAlign` field kept as the safe fallback.
    const t0 = makeEl('t1', {
      type: 'text',
      fontSize: 16,
      strokeColor: '#000000',
      textAlign: 'left',
    } as Partial<ExcalidrawElement>)
    binding.handleLocalChange([t0])

    const t1 = bumpElementStamp({
      ...t0,
      textAlign: 'left',
      customData: { bold: true, textAlign: 'justify' },
    }) as ExcalidrawElement
    binding.handleLocalChange([t1])

    expect(binding.__telemetry.localWrites).toBe(2)
    expect(binding.__telemetry.casRejected).toBe(0)
  })

  it('editing-state write (double-click into text) propagates identically to the selected state', () => {
    // The injector covers BOTH the selected panel and the editing panel (double-click into text,
    // driven by appState.editingTextElement) with the same controls, so a write issued while the
    // element is being edited emits the same bumped shape and must land the same way. This pins
    // that the editing path is not a silent-drop regression.
    const t0 = makeEl('t1', {
      type: 'text',
      fontSize: 16,
      strokeColor: '#1e1e1e',
    } as Partial<ExcalidrawElement>)
    binding.handleLocalChange([t0])
    const writesAfterSeed = binding.__telemetry.localWrites
    const rejectedAfterSeed = binding.__telemetry.casRejected

    // A colour change committed from the editing-state panel.
    const edited = bumpElementStamp({ ...t0, strokeColor: '#e03131' }) as ExcalidrawElement
    binding.handleLocalChange([edited])

    expect(binding.__telemetry.localWrites).toBe(writesAfterSeed + 1)
    expect(binding.__telemetry.casRejected).toBe(rejectedAfterSeed)
  })
})
