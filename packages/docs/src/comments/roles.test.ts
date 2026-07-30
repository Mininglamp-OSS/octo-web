import { describe, it, expect } from 'vitest'
import { canComment, canEdit, canManage } from '../auth/roles.ts'

// Comment permission mapping (feature #3 §, design v0.3 boss decision).
describe('comment role gating', () => {
  it('canComment is commenter+ (reader is strictly read-only; four-role redesign)', () => {
    expect(canComment('reader')).toBe(false)
    expect(canComment('commenter')).toBe(true)
    expect(canComment('writer')).toBe(true)
    expect(canComment('admin')).toBe(true)
  })

  it('resolve / reopen is writer+ (canEdit); commenter cannot', () => {
    expect(canEdit('reader')).toBe(false)
    expect(canEdit('commenter')).toBe(false)
    expect(canEdit('writer')).toBe(true)
    expect(canEdit('admin')).toBe(true)
  })

  it('hard-deleting another user’s comment is admin-only (canManage)', () => {
    expect(canManage('reader')).toBe(false)
    expect(canManage('commenter')).toBe(false)
    expect(canManage('writer')).toBe(false)
    expect(canManage('admin')).toBe(true)
  })
})
