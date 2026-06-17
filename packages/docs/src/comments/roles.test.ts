import { describe, it, expect } from 'vitest'
import { canComment, canEdit, canManage } from '../auth/roles.ts'

// Comment permission mapping (feature #3 §, design v0.3 boss decision).
describe('comment role gating', () => {
  it('canComment is true for any valid role (can see → can comment)', () => {
    expect(canComment('reader')).toBe(true)
    expect(canComment('writer')).toBe(true)
    expect(canComment('admin')).toBe(true)
  })

  it('resolve / reopen is writer+ (canEdit)', () => {
    expect(canEdit('reader')).toBe(false)
    expect(canEdit('writer')).toBe(true)
    expect(canEdit('admin')).toBe(true)
  })

  it('hard-deleting another user’s comment is admin-only (canManage)', () => {
    expect(canManage('reader')).toBe(false)
    expect(canManage('writer')).toBe(false)
    expect(canManage('admin')).toBe(true)
  })
})
