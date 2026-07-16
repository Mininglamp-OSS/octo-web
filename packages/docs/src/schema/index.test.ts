import { describe, it, expect } from 'vitest'
import { SCHEMA_VERSION, SCHEMA_NODES, SCHEMA_MARKS, COLLAB_FIELD } from './index.ts'

// These assertions track docs/schema/SCHEMA-SPEC.md (single source of truth).
// SCHEMA_VERSION 19 is the latest landed; the schema is cumulative, so every earlier
// addition (v2 image, v3 highlight/textStyle, v4 tables, v5 textAlign attr, v6 underline,
// v7 fontSize attr, v8 super/subscript, v9 emoji, v10 mention, v11 details, v12 callout,
// v13 math, v14 fileAttachment, v15 bookmark, v16 fontFamily attr, v17 line-spacing attrs,
// v18 indent attr, v19 tableRow.height attr) is carried forward.
//
// FOLLOW-UP (design §2.5): these are name-membership assertions only. The golden
// schema round-trip regression — encode a fixture doc to a Yjs update, decode it back,
// and assert NORMALIZED STRUCTURAL EQUIVALENCE (NOT a raw encodeStateAsUpdate byte
// compare, which is flaky across clientID / insertion-order differences) — is a
// separate phase. It is intentionally not built here: the v3 binding now runs through
// @tiptap/y-tiptap, so the golden mechanism must be authored against that binding.
describe('docs schema stub (mirrors SCHEMA-SPEC.md)', () => {
  it('is at SCHEMA_VERSION 19', () => {
    expect(SCHEMA_VERSION).toBe(19)
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

  it('adds the v6 underline mark', () => {
    expect(SCHEMA_MARKS).toContain('underline')
  })

  it('adds the v8 superscript and subscript marks', () => {
    expect(SCHEMA_MARKS).toContain('superscript')
    expect(SCHEMA_MARKS).toContain('subscript')
  })

  it('adds the v9 emoji and v10 mention inline nodes', () => {
    expect(SCHEMA_NODES).toContain('emoji')
    expect(SCHEMA_NODES).toContain('mention')
  })

  it('adds the v11 details nodes (details/detailsSummary/detailsContent)', () => {
    for (const n of ['details', 'detailsSummary', 'detailsContent']) {
      expect(SCHEMA_NODES).toContain(n)
    }
  })

  it('adds the v12 callout node', () => {
    expect(SCHEMA_NODES).toContain('callout')
  })

  it('adds the v13 math nodes (inlineMath/blockMath)', () => {
    expect(SCHEMA_NODES).toContain('inlineMath')
    expect(SCHEMA_NODES).toContain('blockMath')
  })

  it('adds the v14 fileAttachment node', () => {
    expect(SCHEMA_NODES).toContain('fileAttachment')
  })

  it('adds the v15 bookmark node', () => {
    expect(SCHEMA_NODES).toContain('bookmark')
  })

  it('keeps the v5/v7/v16/v17/v18/v19 attr-only additions OUT of the node/mark lists (they are attrs)', () => {
    // textAlign + indent ride on heading/paragraph; fontSize + fontFamily ride on the textStyle mark;
    // lineHeight/spaceBefore/spaceAfter (v17) ride on heading/paragraph; height (v19) rides on tableRow.
    expect(SCHEMA_NODES).not.toContain('textAlign')
    expect(SCHEMA_MARKS).not.toContain('textAlign')
    expect(SCHEMA_MARKS).not.toContain('fontSize')
    expect(SCHEMA_MARKS).not.toContain('fontFamily')
    for (const attr of ['lineHeight', 'spaceBefore', 'spaceAfter']) {
      expect(SCHEMA_NODES).not.toContain(attr)
      expect(SCHEMA_MARKS).not.toContain(attr)
    }
    expect(SCHEMA_NODES).not.toContain('indent')
    expect(SCHEMA_MARKS).not.toContain('indent')
    // v19: `height` is a tableRow ATTRIBUTE, so `tableRow` stays in the node list (v4) but `height`
    // itself is never its own node/mark.
    expect(SCHEMA_NODES).toContain('tableRow')
    expect(SCHEMA_NODES).not.toContain('height')
    expect(SCHEMA_MARKS).not.toContain('height')
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
