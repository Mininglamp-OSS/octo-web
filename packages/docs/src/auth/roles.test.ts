import { describe, it, expect } from 'vitest'
import { canComment, canEdit, canManage, canSnapshot, canRestoreVersion, isRole, type Role } from './roles.ts'

// Four-role capability matrix (reader < commenter < writer < admin). The redesign made
// commenting commenter+ (a reader is strictly read-only) while edit/manage stay writer/admin.
describe('four-role capability matrix', () => {
  const ALL: Role[] = ['reader', 'commenter', 'writer', 'admin']

  it('isRole accepts exactly the four roles and rejects anything else', () => {
    for (const r of ALL) expect(isRole(r)).toBe(true)
    expect(isRole('author')).toBe(false)
    expect(isRole('editor')).toBe(false)
    expect(isRole('')).toBe(false)
    expect(isRole(null)).toBe(false)
    expect(isRole(undefined)).toBe(false)
    expect(isRole(3)).toBe(false)
  })

  it('canComment = commenter | writer | admin (reader is read-only)', () => {
    expect(canComment('reader')).toBe(false)
    expect(canComment('commenter')).toBe(true)
    expect(canComment('writer')).toBe(true)
    expect(canComment('admin')).toBe(true)
  })

  it('canEdit = writer | admin (commenter cannot edit)', () => {
    expect(canEdit('reader')).toBe(false)
    expect(canEdit('commenter')).toBe(false)
    expect(canEdit('writer')).toBe(true)
    expect(canEdit('admin')).toBe(true)
  })

  it('canManage = admin only', () => {
    expect(canManage('reader')).toBe(false)
    expect(canManage('commenter')).toBe(false)
    expect(canManage('writer')).toBe(false)
    expect(canManage('admin')).toBe(true)
  })

  it('capability ladder is monotone: canManage ⇒ canEdit ⇒ canComment', () => {
    for (const r of ALL) {
      if (canManage(r)) expect(canEdit(r)).toBe(true)
      if (canEdit(r)) expect(canComment(r)).toBe(true)
    }
  })
})

// Version-history capability gating (feature #4 §6). Restore/delete are admin-only — a
// writer must NOT be able to roll the authoritative state back (boss decision).
describe('version-history role gating', () => {
  it('canSnapshot = writer || admin (aligns with canEdit)', () => {
    expect(canSnapshot('reader')).toBe(false)
    expect(canSnapshot('commenter')).toBe(false)
    expect(canSnapshot('writer')).toBe(true)
    expect(canSnapshot('admin')).toBe(true)
    expect(canSnapshot('writer')).toBe(canEdit('writer'))
  })

  it('canRestoreVersion = admin only (aligns with canManage)', () => {
    expect(canRestoreVersion('reader')).toBe(false)
    expect(canRestoreVersion('commenter')).toBe(false)
    expect(canRestoreVersion('writer')).toBe(false)
    expect(canRestoreVersion('admin')).toBe(true)
    expect(canRestoreVersion('admin')).toBe(canManage('admin'))
  })
})
