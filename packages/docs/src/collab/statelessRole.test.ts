import { describe, it, expect, vi } from 'vitest'
import { RoleController } from './statelessRole.ts'
import type { Role } from '../auth/roles.ts'

function make(initialRole: Role = 'writer', initialEpoch = 1) {
  const onRole = vi.fn()
  const disposeToken = vi.fn()
  const ctrl = new RoleController({
    documentName: 'octo:s:f:d',
    initialRole,
    initialEpoch,
    onRole,
    disposeToken,
  })
  return { ctrl, onRole, disposeToken }
}

function frame(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

describe('RoleController — stateless role-change handling', () => {
  it('applies a role-change frame with a higher epoch', () => {
    const { ctrl, onRole } = make('writer', 1)
    const applied = ctrl.handleStatelessFrame(frame({ type: 'role-change', role: 'reader', permission_epoch: 2 }))
    expect(applied).toBe(true)
    expect(ctrl.getRole()).toBe('reader')
    expect(ctrl.getEpoch()).toBe(2)
    expect(onRole).toHaveBeenCalledWith('reader')
  })

  it('ignores frames whose type is not exactly "role-change"', () => {
    const { ctrl, onRole } = make('writer', 1)
    expect(ctrl.handleStatelessFrame(frame({ type: 'permission', role: 'reader', permission_epoch: 5 }))).toBe(false)
    expect(ctrl.getRole()).toBe('writer')
    expect(onRole).not.toHaveBeenCalled()
  })

  it('drops frames with a lower epoch (stale writer cannot overwrite newer reader)', () => {
    const { ctrl, onRole } = make('writer', 1)
    ctrl.handleStatelessFrame(frame({ type: 'role-change', role: 'reader', permission_epoch: 5 }))
    onRole.mockClear()
    const applied = ctrl.handleStatelessFrame(frame({ type: 'role-change', role: 'writer', permission_epoch: 3 }))
    expect(applied).toBe(false)
    expect(ctrl.getRole()).toBe('reader')
    expect(onRole).not.toHaveBeenCalled()
  })

  it('applies a frame with an equal epoch (frontend §7.5 drops only strictly-lower epochs)', () => {
    const { ctrl } = make('writer', 4)
    expect(ctrl.handleStatelessFrame(frame({ type: 'role-change', role: 'reader', permission_epoch: 4 }))).toBe(true)
    expect(ctrl.getRole()).toBe('reader')
  })

  it('rejects an invalid role enum', () => {
    const { ctrl } = make('writer', 1)
    expect(ctrl.handleStatelessFrame(frame({ type: 'role-change', role: 'god', permission_epoch: 9 }))).toBe(false)
    expect(ctrl.getRole()).toBe('writer')
  })

  it('keeps current state on malformed JSON', () => {
    const { ctrl, onRole } = make('writer', 1)
    expect(ctrl.handleStatelessFrame('{not json')).toBe(false)
    expect(ctrl.getRole()).toBe('writer')
    expect(onRole).not.toHaveBeenCalled()
  })

  it('disposes the token on downgrade (role can no longer edit)', () => {
    const { ctrl, disposeToken } = make('writer', 1)
    ctrl.handleStatelessFrame(frame({ type: 'role-change', role: 'reader', permission_epoch: 2 }))
    expect(disposeToken).toHaveBeenCalledWith('octo:s:f:d')
  })

  it('does not dispose the token when role remains editable (e.g. writer->admin)', () => {
    const { ctrl, disposeToken } = make('writer', 1)
    ctrl.handleStatelessFrame(frame({ type: 'role-change', role: 'admin', permission_epoch: 2 }))
    expect(disposeToken).not.toHaveBeenCalled()
    expect(ctrl.getRole()).toBe('admin')
  })
})
