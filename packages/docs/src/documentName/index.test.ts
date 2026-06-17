import { describe, it, expect } from 'vitest'
import { buildDocumentName, parseDocumentName } from './index.ts'

describe('buildDocumentName', () => {
  it('builds a 4-segment document key with octo prefix', () => {
    expect(buildDocumentName('wiki', 'f_888', 'doc_30af19')).toBe('octo:wiki:f_888:doc_30af19')
  })

  it('rejects empty segments', () => {
    expect(() => buildDocumentName('', 'f', 'd')).toThrow()
    expect(() => buildDocumentName('s', '', 'd')).toThrow()
    expect(() => buildDocumentName('s', 'f', '')).toThrow()
  })

  it('rejects segments containing the ":" separator (injection guard)', () => {
    expect(() => buildDocumentName('s', 'f', 'a:b')).toThrow()
    expect(() => buildDocumentName('s', 'f:x', 'd')).toThrow()
  })

  it('rejects a doc segment equal to the whiteboard literal "wb"', () => {
    expect(() => buildDocumentName('s', 'f', 'wb')).toThrow()
  })
})

describe('parseDocumentName — 4-segment document key', () => {
  it('parses a document key, segment 3 is folder', () => {
    const parsed = parseDocumentName('octo:s_001:f_888:d_abc123')
    expect(parsed).toEqual({ kind: 'document', space: 's_001', folder: 'f_888', doc: 'd_abc123' })
  })

  it('round-trips with buildDocumentName', () => {
    const name = buildDocumentName('wiki', 'f_1', 'd_1')
    const parsed = parseDocumentName(name)
    expect(parsed.kind).toBe('document')
    if (parsed.kind === 'document') {
      expect(buildDocumentName(parsed.space, parsed.folder, parsed.doc)).toBe(name)
    }
  })
})

describe('parseDocumentName — 5-segment whiteboard key (non-symmetric)', () => {
  it('identifies a whiteboard key via positional parts[3]==="wb"', () => {
    const parsed = parseDocumentName('octo:s_001:f_888:wb:board_7')
    expect(parsed).toEqual({ kind: 'whiteboard', space: 's_001', folder: 'f_888', board: 'board_7' })
  })

  it('a 5-segment key whose 4th part is NOT "wb" is invalid (not a doc, not a wb)', () => {
    expect(() => parseDocumentName('octo:s:f:x:y')).toThrow()
  })
})

describe('parseDocumentName — rejection matrix', () => {
  it('rejects non-octo namespace', () => {
    expect(() => parseDocumentName('foo:s:f:d')).toThrow()
  })
  it('rejects wrong segment counts', () => {
    expect(() => parseDocumentName('octo:s:d')).toThrow()
    expect(() => parseDocumentName('octo:s:f:d:e:extra')).toThrow()
  })
  it('rejects empty segments', () => {
    expect(() => parseDocumentName('octo:s::d')).toThrow()
  })
  it('rejects a doc segment equal to "wb" (ambiguous)', () => {
    expect(() => parseDocumentName('octo:s:f:wb')).toThrow()
  })
})
