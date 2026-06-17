import { describe, it, expect } from 'vitest'
import { canEdit, canManage, canSnapshot, canRestoreVersion } from './roles.ts'

// Version-history capability gating (feature #4 §6). Restore/delete are admin-only — a
// writer must NOT be able to roll the authoritative state back (boss decision).
describe('version-history role gating', () => {
  it('canSnapshot = writer || admin (aligns with canEdit)', () => {
    expect(canSnapshot('reader')).toBe(false)
    expect(canSnapshot('writer')).toBe(true)
    expect(canSnapshot('admin')).toBe(true)
    expect(canSnapshot('writer')).toBe(canEdit('writer'))
  })

  it('canRestoreVersion = admin only (aligns with canManage)', () => {
    expect(canRestoreVersion('reader')).toBe(false)
    expect(canRestoreVersion('writer')).toBe(false)
    expect(canRestoreVersion('admin')).toBe(true)
    expect(canRestoreVersion('admin')).toBe(canManage('admin'))
  })
})
