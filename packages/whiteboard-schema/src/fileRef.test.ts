// Shared FileRef contract helpers (XIN-702). These are the ONE authoritative rule for "is this
// whiteboard image reference usable", imported verbatim by both the FE binding and the BE repair —
// so a ref written by one side is judged identically by the other.
import { describe, it, expect } from 'vitest'
import { buildFileRef, normalizeFileRef, isUsableFileRef, FILE_REF_STATUS } from './fileRef.ts'

describe('buildFileRef', () => {
  it('produces the canonical field set and defaults status to saved', () => {
    const ref = buildFileRef({ attachId: 'att-1', mimeType: 'image/png', createdAt: 42 })
    expect(ref).toEqual({ attachId: 'att-1', mimeType: 'image/png', status: 'saved', createdAt: 42 })
  })

  it('honours an explicit pending status and omits absent optional fields', () => {
    expect(buildFileRef({ attachId: 'a', status: FILE_REF_STATUS.pending })).toEqual({
      attachId: 'a',
      status: 'pending',
    })
  })

  it('never carries binary — unknown extra fields pass through, dataURL is only what the caller set', () => {
    const ref = buildFileRef({ attachId: 'a', extra: 'x' } as { attachId: string; extra: string })
    expect(ref.attachId).toBe('a')
    expect((ref as Record<string, unknown>).extra).toBe('x')
  })
})

describe('normalizeFileRef / isUsableFileRef', () => {
  it('rejects a ref with no usable attachId (the grey-placeholder bug in data form)', () => {
    expect(normalizeFileRef({ mimeType: 'image/png' })).toBeNull()
    expect(normalizeFileRef({ attachId: '' })).toBeNull()
    expect(normalizeFileRef(null)).toBeNull()
    expect(isUsableFileRef({ attachId: '' })).toBe(false)
    expect(isUsableFileRef({ attachId: 'att-1' })).toBe(true)
  })

  it('keeps a numeric finite createdAt and drops a blank mimeType/status', () => {
    expect(normalizeFileRef({ attachId: 'a', mimeType: '', status: '', createdAt: 7 })).toEqual({
      attachId: 'a',
      createdAt: 7,
    })
    expect(normalizeFileRef({ attachId: 'a', createdAt: Infinity })).toEqual({ attachId: 'a' })
  })

  it('round-trips a built ref', () => {
    const built = buildFileRef({ attachId: 'a', mimeType: 'image/jpeg', createdAt: 1 })
    expect(normalizeFileRef(built)).toEqual(built)
    expect(isUsableFileRef(built)).toBe(true)
  })
})
