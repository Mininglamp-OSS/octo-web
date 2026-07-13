// Shared schema package (@octo/whiteboard-schema, XIN-16 §3) — wired via the seam.
import { describe, it, expect } from 'vitest'
import {
  ELEMENTS_FIELD,
  FILES_FIELD,
  WB_SCHEMA_VERSION,
  WB_ELEMENT_TYPES,
  buildWhiteboardName,
  parseWhiteboardName,
  normalizeElement,
  SCHEMA_PACKAGE_WIRED,
} from '../schema.ts'

describe('shared schema seam', () => {
  it('the real @octo/whiteboard-schema is wired in (no placeholder)', () => {
    expect(SCHEMA_PACKAGE_WIRED).toBe(true)
  })

  it('locks the top-level field names (XIN-16 §1/§2)', () => {
    expect(ELEMENTS_FIELD).toBe('elements')
    expect(FILES_FIELD).toBe('files')
  })

  it('owns a whiteboard schema version independent of the PM docs version', () => {
    expect(WB_SCHEMA_VERSION).toBe(2)
    expect(WB_ELEMENT_TYPES.has('image')).toBe(true)
    expect(WB_ELEMENT_TYPES.has('arrow')).toBe(true)
  })

  it('builds and parses the canonical board key octo:{space}:{folder}:wb:{board}', () => {
    const key = buildWhiteboardName('s1', 'f1', 'b1')
    expect(key).toBe('octo:s1:f1:wb:b1')
    expect(parseWhiteboardName(key)).toEqual({ space: 's1', folder: 'f1', board: 'b1' })
  })

  it('rejects forged segments (injection guard) and non-board keys', () => {
    expect(() => buildWhiteboardName('s:1', 'f', 'b')).toThrow()
    expect(() => parseWhiteboardName('octo:s:f:d')).toThrow()
  })

  it('normalizeElement coerces a bad version and preserves unknown fields (M-12)', () => {
    const out = normalizeElement({ id: 'a', type: 'rectangle', version: 0, mystery: 42 })
    expect(out).not.toBeNull()
    expect(out!.version).toBe(1)
    expect((out as Record<string, unknown>).mystery).toBe(42)
  })

  it('normalizeElement drops unrenderable elements (bad id / non-whitelist type)', () => {
    expect(normalizeElement({ id: '', type: 'rectangle' })).toBeNull()
    expect(normalizeElement({ id: 'a', type: 'wormhole' })).toBeNull()
  })

  it('normalizeElement clears a dangling containerId against the surviving set (M-5, v2)', () => {
    const ctx = { elementIds: new Set(['box']) }
    const orphan = normalizeElement({ id: 't', type: 'text', containerId: 'gone' }, ctx)
    expect(orphan!.containerId).toBeNull()
    const bound = normalizeElement({ id: 't', type: 'text', containerId: 'box' }, ctx)
    expect(bound!.containerId).toBe('box')
  })
})
