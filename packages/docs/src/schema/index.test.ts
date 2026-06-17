import { describe, it, expect } from 'vitest'
import { SCHEMA_VERSION, SCHEMA_NODES, SCHEMA_MARKS, COLLAB_FIELD } from './index.ts'

// These assertions track docs/schema/SCHEMA-SPEC.md (single source of truth).
// SCHEMA_VERSION 4 (§4) adds the table nodes; the schema is cumulative, so the v2
// `image` node and the v3 `highlight`/`textStyle` marks are carried forward.
//
// FOLLOW-UP (design §2.5): these are name-membership assertions only. The golden
// schema round-trip regression — encode a fixture doc to a Yjs update, decode it back,
// and assert NORMALIZED STRUCTURAL EQUIVALENCE (NOT a raw encodeStateAsUpdate byte
// compare, which is flaky across clientID / insertion-order differences) — is a
// separate phase. It is intentionally not built here: the v3 binding now runs through
// @tiptap/y-tiptap, so the golden mechanism must be authored against that binding.
describe('docs schema stub (mirrors SCHEMA-SPEC.md)', () => {
  it('is at SCHEMA_VERSION 4', () => {
    expect(SCHEMA_VERSION).toBe(4)
  })

  it('carries the v1 baseline marks', () => {
    for (const m of ['bold', 'italic', 'strike', 'code', 'link']) {
      expect(SCHEMA_MARKS).toContain(m)
    }
  })

  it('carries the v3 highlight and textStyle marks forward', () => {
    expect(SCHEMA_MARKS).toContain('highlight')
    expect(SCHEMA_MARKS).toContain('textStyle')
  })

  it('carries the v2 image node forward (cumulative schema)', () => {
    expect(SCHEMA_NODES).toContain('image')
  })

  it('adds the v4 table nodes (table/tableRow/tableCell/tableHeader)', () => {
    for (const n of ['table', 'tableRow', 'tableCell', 'tableHeader']) {
      expect(SCHEMA_NODES).toContain(n)
    }
  })

  it('keeps the v1 baseline nodes', () => {
    for (const n of ['doc', 'paragraph', 'text', 'heading', 'codeBlock']) {
      expect(SCHEMA_NODES).toContain(n)
    }
  })

  it('keeps the collab field name stable (must match backend)', () => {
    expect(COLLAB_FIELD).toBe('default')
  })
})
