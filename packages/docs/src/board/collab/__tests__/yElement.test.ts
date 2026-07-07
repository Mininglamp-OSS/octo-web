// Field-level element ⇆ Y.Map conversion (T2 field-level granularity, M-12 unknown passthrough).
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  readAllElements,
  readElement,
  upsertElement,
  writeElementFields,
  jsonEqual,
} from '../yElement.ts'
import { makeEl } from './helpers.ts'

function elementsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('elements')
}

describe('per-element Y.Map conversion', () => {
  it('T2: stores each element as a field-level Y.Map and round-trips', () => {
    const doc = new Y.Doc()
    const els = elementsMap(doc)
    const el = makeEl('a', { x: 5, y: 6 })
    doc.transact(() => upsertElement(els, el))

    const yEl = els.get('a')!
    expect(yEl).toBeInstanceOf(Y.Map)
    expect(yEl.get('x')).toBe(5)
    const back = readElement(yEl)
    expect(back.id).toBe('a')
    expect(back.x).toBe(5)
    expect(back.y).toBe(6)
  })

  it('T2: a single-field edit writes ONLY that field (field-level diff)', () => {
    const doc = new Y.Doc()
    const els = elementsMap(doc)
    doc.transact(() => upsertElement(els, makeEl('a', { x: 1, y: 1 })))
    const yEl = els.get('a')!

    // changing only x should mutate exactly one field
    const mutated = writeElementFields(yEl, { ...readElement(yEl), x: 2 })
    expect(mutated).toBe(1)
    expect(yEl.get('x')).toBe(2)
    expect(yEl.get('y')).toBe(1)
  })

  it('drops fields that disappear from the element', () => {
    const doc = new Y.Doc()
    const els = elementsMap(doc)
    doc.transact(() => upsertElement(els, makeEl('a', { frameId: 'f1' })))
    const yEl = els.get('a')!
    expect(yEl.has('frameId')).toBe(true)

    const next = readElement(yEl)
    delete (next as Record<string, unknown>).frameId
    doc.transact(() => writeElementFields(yEl, next))
    expect(yEl.has('frameId')).toBe(false)
  })

  it('M-12: unknown / future fields pass through verbatim', () => {
    const doc = new Y.Doc()
    const els = elementsMap(doc)
    const el = makeEl('a', { someFutureField: { nested: [1, 2, 3] } } as never)
    doc.transact(() => upsertElement(els, el))

    const back = readElement(els.get('a')!) as Record<string, unknown>
    expect(back.someFutureField).toEqual({ nested: [1, 2, 3] })
  })

  it('jsonEqual compares deeply', () => {
    expect(jsonEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(jsonEqual([1, 2], [1, 2, 3])).toBe(false)
  })
})

describe('readAllElements — untrusted peer container guard (P1-2)', () => {
  it('reads back every well-formed element as a plain object', () => {
    const doc = new Y.Doc()
    const els = elementsMap(doc)
    doc.transact(() => {
      upsertElement(els, makeEl('a', { x: 1 }))
      upsertElement(els, makeEl('b', { x: 2 }))
    })
    const all = readAllElements(els)
    expect(all.map((e) => e.id).sort()).toEqual(['a', 'b'])
  })

  it('drops a non-Y.Map value under an element key instead of throwing (denial-of-render)', () => {
    const doc = new Y.Doc()
    const els = elementsMap(doc)
    doc.transact(() => {
      upsertElement(els, makeEl('good', { x: 1 }))
    })
    // A malicious/buggy peer can store a NON-Y.Map value under an element key — a Yjs update is not
    // runtime-typed. readElement assumes a Y.Map (.forEach); before the guard this threw and aborted
    // the whole read, so ONE bad entry blanked every valid peer element.
    doc.transact(() => {
      // Scalar under an element key.
      ;(els as unknown as Y.Map<unknown>).set('scalar', 42)
      // A different shared type (Y.Array) under an element key.
      ;(els as unknown as Y.Map<unknown>).set('array', new Y.Array())
    })

    let all: ReturnType<typeof readAllElements> = []
    expect(() => {
      all = readAllElements(els)
    }).not.toThrow()
    // The one valid element still renders; the malformed entries are dropped.
    expect(all.map((e) => e.id)).toEqual(['good'])
  })
})
