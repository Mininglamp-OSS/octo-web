// Schema seam (XIN-16 §3) — constants + validated key codec. The `normalizeElement` rule set is
// the ONE package-gated piece (placeholder until @octo/whiteboard-schema / XIN-26 publishes).
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
import { makeEl } from './helpers.ts'

describe('schema seam', () => {
  it('locks the top-level field names (XIN-16 §1/§2)', () => {
    expect(ELEMENTS_FIELD).toBe('elements')
    expect(FILES_FIELD).toBe('files')
  })

  it('owns a whiteboard schema version independent of the PM docs version', () => {
    expect(typeof WB_SCHEMA_VERSION).toBe('number')
    expect(WB_ELEMENT_TYPES).toContain('image')
    expect(WB_ELEMENT_TYPES).toContain('arrow')
  })

  it('builds and parses the canonical board key octo:{space}:{folder}:wb:{board}', () => {
    const key = buildWhiteboardName('s1', 'f1', 'b1')
    expect(key).toBe('octo:s1:f1:wb:b1')
    expect(parseWhiteboardName(key)).toEqual({ space: 's1', folder: 'f1', board: 'b1' })
  })

  it('rejects forged segments (injection guard via the validated codec)', () => {
    expect(() => buildWhiteboardName('s:1', 'f', 'b')).toThrow()
  })

  it('parseWhiteboardName returns null for a non-board key', () => {
    expect(parseWhiteboardName('octo:s:f:d')).toBeNull()
    expect(parseWhiteboardName('garbage')).toBeNull()
  })

  it('placeholder normalizeElement is identity + preserves unknown fields (M-12)', () => {
    const el = makeEl('a', { mystery: 42 } as never)
    const out = normalizeElement(el) as Record<string, unknown>
    expect(out.id).toBe('a')
    expect(out.mystery).toBe(42)
    // seam is not yet wired to the real shared package
    expect(SCHEMA_PACKAGE_WIRED).toBe(false)
  })
})
