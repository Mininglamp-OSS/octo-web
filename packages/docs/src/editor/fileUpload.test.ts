import { describe, it, expect } from 'vitest'
import { resolveUploadMime } from './fileUpload.ts'

// #D3 (Batch 4): the browser leaves file.type empty for many files; the old code fell back to
// the catch-all application/octet-stream which the backend whitelist rejects. resolveUploadMime
// trusts a concrete declared type, else resolves from the filename extension, else returns null
// so the caller can warn ("unsupported file type") instead of silently sending octet-stream.
describe('resolveUploadMime', () => {
  it('trusts a concrete declared mime', () => {
    expect(resolveUploadMime('a.pdf', 'application/pdf')).toBe('application/pdf')
    expect(resolveUploadMime('weird.bin', 'image/png')).toBe('image/png')
  })

  it('resolves from extension when declared type is empty', () => {
    expect(resolveUploadMime('report.pdf', '')).toBe('application/pdf')
    expect(resolveUploadMime('sheet.xlsx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(resolveUploadMime('archive.ZIP', '')).toBe('application/zip')
    expect(resolveUploadMime('notes.txt', '')).toBe('text/plain')
  })

  it('resolves from extension when declared type is the catch-all octet-stream', () => {
    expect(resolveUploadMime('doc.docx', 'application/octet-stream')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    // case-insensitive on the declared type too
    expect(resolveUploadMime('a.pdf', 'APPLICATION/OCTET-STREAM')).toBe('application/pdf')
  })

  it('returns null for unknown / unmappable types (caller warns, never sends octet-stream)', () => {
    expect(resolveUploadMime('mystery.xyz', '')).toBeNull()
    expect(resolveUploadMime('noext', '')).toBeNull()
    expect(resolveUploadMime('trailingdot.', 'application/octet-stream')).toBeNull()
  })
})
