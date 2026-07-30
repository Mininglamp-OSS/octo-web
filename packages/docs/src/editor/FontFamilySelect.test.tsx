import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

// Regression guard for PR #1165 / P1-1: the unavailable-font warning marker must appear only in the
// OPEN menu rows, never inside the collapsed Select trigger. Univer's <Select> reuses the selected
// option's `label` node as the collapsed trigger's content (its `displayValue`) AND as the menu row,
// so a marker embedded in the applied font's label leaked into the 172px trigger — a dead zone that
// (with the old stopPropagation handlers) also swallowed clicks meant to open the picker.
//
// The @univerjs/design Select is mocked with a faithful stand-in that reproduces exactly that
// dual-use: the trigger shows the selected option's label node, and the menu (mounted only while
// open, like the real Radix dropdown) shows every option's label node. This is what makes the test
// capable of failing against the pre-fix code — the marker rendered through the trigger's label.
const { unavailableFonts } = vi.hoisted(() => ({ unavailableFonts: new Set<string>() }))

vi.mock('./fontFamilies.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fontFamilies.ts')>()
  return { ...actual, isFontFamilySupported: (value: string) => !unavailableFonts.has(value) }
})

vi.mock('@univerjs/design', async () => {
  const React = await import('react')
  const passthrough = ({ children }: { children: React.ReactNode }) => children
  return {
    ConfigProvider: passthrough,
    Tooltip: passthrough,
    DropdownMenu: passthrough,
    ColorPicker: () => null,
    // Faithful Select: `displayValue` is the SELECTED option's label node (rendered in the collapsed
    // trigger); the menu rows are mounted only while open and each renders its own label node.
    Select: ({
      value,
      options,
      onChange,
    }: {
      value: string
      options: { label: React.ReactNode; value: string }[]
      onChange?: (v: string) => void
    }) => {
      const [open, setOpen] = React.useState(false)
      const selected = options.find((o) => o.value === value)
      return React.createElement(
        'div',
        { 'data-u-comp': 'select' },
        React.createElement(
          'div',
          { 'data-testid': 'select-trigger', onClick: () => setOpen((o) => !o) },
          selected ? selected.label : value,
        ),
        open &&
          React.createElement(
            'div',
            { 'data-testid': 'select-menu', role: 'listbox' },
            options.map((o) =>
              React.createElement(
                'div',
                {
                  key: String(o.value),
                  role: 'option',
                  onClick: () => {
                    onChange?.(o.value)
                    setOpen(false)
                  },
                },
                o.label,
              ),
            ),
          ),
      )
    },
  }
})

import { FontFamilySelect } from './Toolbar.tsx'

/** Minimal editor stand-in: FontFamilySelect only reads the current `fontFamily` attr and subscribes
 * for re-renders (no transaction is dispatched during these tests). */
function makeEditor(currentFontFamily: string): Editor {
  return {
    on: () => {},
    off: () => {},
    state: { selection: { from: 0, to: 0 } },
    getAttributes: (name: string) =>
      name === 'textStyle' ? { fontFamily: currentFontFamily } : {},
    chain: () => ({
      focus: () => ({
        setFontFamily: () => ({ run: () => {} }),
        unsetFontFamily: () => ({ run: () => {} }),
      }),
    }),
  } as unknown as Editor
}

const IMPACT = 'Impact, sans-serif'
const COMIC = '"Comic Sans MS", cursive'

afterEach(() => {
  cleanup()
  unavailableFonts.clear()
})

describe('FontFamilySelect — unavailable-font warning placement (PR #1165 P1-1)', () => {
  it('renders the warning marker in open menu rows but never in the collapsed trigger', () => {
    // The currently-applied font AND another catalogue font are both unavailable locally.
    unavailableFonts.add(IMPACT)
    unavailableFonts.add(COMIC)
    const { container } = render(<FontFamilySelect editor={makeEditor(IMPACT)} />)

    // Collapsed: the trigger shows the applied font (Impact) but carries NO warning marker — the
    // marker used to leak here through the selected option's label node.
    expect(container.querySelector('.octo-tb-font-warning')).toBeNull()

    // Open the picker.
    fireEvent.click(within(container).getByTestId('select-trigger'))
    const menu = within(container).getByTestId('select-menu')

    // The other unavailable font's row DOES carry the marker (warning retained in the menu).
    expect(menu.querySelectorAll('.octo-tb-font-warning').length).toBeGreaterThan(0)
  })

  it('leaves the collapsed trigger operable when the applied font is unavailable (no dead zone)', () => {
    unavailableFonts.add(IMPACT)
    const { container } = render(<FontFamilySelect editor={makeEditor(IMPACT)} />)

    const trigger = within(container).getByTestId('select-trigger')
    // No click-swallowing marker sits inside the trigger…
    expect(trigger.querySelector('.octo-tb-font-warning')).toBeNull()
    // …so a click opens the picker.
    fireEvent.click(trigger)
    expect(within(container).queryByTestId('select-menu')).not.toBeNull()
  })

  it('shows no marker at all when every catalogue font is available', () => {
    const { container } = render(<FontFamilySelect editor={makeEditor('')} />)
    fireEvent.click(within(container).getByTestId('select-trigger'))
    expect(container.querySelectorAll('.octo-tb-font-warning').length).toBe(0)
  })
})
