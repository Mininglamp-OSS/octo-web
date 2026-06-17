import { describe, it, expect } from 'vitest'
import { shouldShowFloatingMenu } from './Toolbar.tsx'

// Helper to build the minimal selection shape the predicate inspects.
function sel(opts: {
  empty?: boolean
  depth?: number
  isTextblock?: boolean
  childCount?: number
  code?: boolean
}) {
  return {
    empty: opts.empty ?? true,
    $anchor: {
      depth: opts.depth ?? 1,
      parent: {
        isTextblock: opts.isTextblock ?? true,
        childCount: opts.childCount ?? 0,
        type: { spec: { code: opts.code } },
      },
    },
  }
}

describe('shouldShowFloatingMenu (block-insert menu guard)', () => {
  it('shows on an empty paragraph at root depth with empty selection', () => {
    expect(shouldShowFloatingMenu({ isEditable: true, selection: sel({}) })).toBe(true)
  })

  it('hides inside a code block (the pre-existing bug: H1 there destroyed the block)', () => {
    expect(shouldShowFloatingMenu({ isEditable: true, selection: sel({ code: true }) })).toBe(false)
  })

  it('hides when the text block is non-empty', () => {
    expect(shouldShowFloatingMenu({ isEditable: true, selection: sel({ childCount: 3 }) })).toBe(false)
  })

  it('hides when the selection is not empty (a range is selected)', () => {
    expect(shouldShowFloatingMenu({ isEditable: true, selection: sel({ empty: false }) })).toBe(false)
  })

  it('hides when not at root depth (nested block)', () => {
    expect(shouldShowFloatingMenu({ isEditable: true, selection: sel({ depth: 2 }) })).toBe(false)
  })

  it('hides when the editor is not editable', () => {
    expect(shouldShowFloatingMenu({ isEditable: false, selection: sel({}) })).toBe(false)
  })

  it('hides when the parent is not a text block', () => {
    expect(shouldShowFloatingMenu({ isEditable: true, selection: sel({ isTextblock: false }) })).toBe(false)
  })
})
