import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ColorSplitControl } from './colorControl.tsx'

vi.mock('@univerjs/design', async () => {
  const React = await import('react')
  return {
    Tooltip: ({ children }: { children: ReactNode }) => children,
    ColorPicker: ({ onChange }: { onChange?: (color: string) => void }) => (
      <div onClick={(event) => event.stopPropagation()}>
        <div data-u-comp="color-picker-presets">
          <button data-testid="preset-white">white preset</button>
        </div>
        <button data-testid="pick" onClick={() => onChange?.('#3370ff')}>custom confirm</button>
        <div data-testid="dialog-overlay" />
        <div role="dialog">
          <div data-u-comp="color-picker-spectrum" />
          <button data-testid="dialog-inside">inside</button>
        </div>
      </div>
    ),
  }
})

vi.mock('../octoweb/index.ts', () => ({
  t: (key: string) => key,
  i18n: { getLocale: () => 'en-US' },
}))

afterEach(() => {
  cleanup()
  document.getElementById('octo-univer-portal')?.remove()
})

function control(initialColor = '#e03131', portalPopover = false) {
  const main = vi.fn()
  const picked = vi.fn()
  const view = render(
    <ColorSplitControl
      title="colour"
      initialColor={initialColor}
      renderIcon={(color) => <span data-testid="swatch">{color}</span>}
      onMainClick={main}
      onPick={picked}
      onClear={() => {}}
      portalPopover={portalPopover}
    />,
  )
  return { ...view, main, picked }
}

describe('ColorSplitControl', () => {
  it('commits the opaque white preset immediately even though Univer 0.25 only updates internal HSV', () => {
    const view = control()
    fireEvent.click(view.container.querySelector('.octo-color-caret-btn')!)
    fireEvent.pointerDown(view.getByTestId('preset-white'))

    expect(view.picked).toHaveBeenCalledTimes(1)
    expect(view.picked).toHaveBeenCalledWith('#FFFFFF')
    expect(view.getByTestId('swatch').textContent).toBe('#FFFFFF')
    expect(view.container.querySelector('.octo-color-popover')).toBeNull()
  })

  it('preserves the last-picked colour across parent rerenders instead of resetting it', () => {
    const view = control()
    fireEvent.click(view.container.querySelector('.octo-color-caret-btn')!)
    fireEvent.click(view.getByTestId('pick'))
    expect(view.picked).toHaveBeenCalledWith('#3370ff')

    view.rerender(
      <ColorSplitControl
        title="colour"
        initialColor="#2f9e44"
        renderIcon={(color) => <span data-testid="swatch">{color}</span>}
        onMainClick={view.main}
        onPick={view.picked}
        onClear={() => {}}
      />,
    )
    expect(view.getByTestId('swatch').textContent).toBe('#3370ff')
    fireEvent.click(view.container.querySelector('.octo-color-main')!)
    expect(view.main).toHaveBeenLastCalledWith('#3370ff')
  })

  it('keeps wheel and trackpad-style scrolling inside the body-portal dialog', () => {
    const view = control('#e03131', true)
    fireEvent.click(view.container.querySelector('.octo-color-caret-btn')!)
    const dialog = view.getByTestId('dialog-inside').closest('[role="dialog"]')!
    const documentWheel = vi.fn()
    const documentTouchMove = vi.fn()
    document.addEventListener('wheel', documentWheel)
    document.addEventListener('touchmove', documentTouchMove)

    fireEvent.wheel(dialog, { deltaY: 80 })
    fireEvent.touchMove(dialog)

    expect(documentWheel).not.toHaveBeenCalled()
    expect(documentTouchMove).not.toHaveBeenCalled()
    expect(view.container.querySelector('.octo-color-caret-btn')!.className).toContain('is-active')
    document.removeEventListener('wheel', documentWheel)
    document.removeEventListener('touchmove', documentTouchMove)
  })

  it('keeps a Radix body-portal dialog click open, but tears down on a true outside click', () => {
    const view = control('#e03131', true)
    fireEvent.click(view.container.querySelector('.octo-color-caret-btn')!)
    const caret = view.container.querySelector('.octo-color-caret-btn')!
    expect(caret.className).toContain('is-active')
    expect(
      document.querySelector('.octo-board-color-popover')?.hasAttribute('data-prevent-outside-click'),
    ).toBe(true)

    const dialog = view.getByTestId('dialog-inside').closest('[role="dialog"]')!
    const overlay = view.getByTestId('dialog-overlay')
    expect(dialog.hasAttribute('data-prevent-outside-click')).toBe(true)
    expect(dialog.classList.contains('octo-theme')).toBe(true)
    expect(dialog.classList.contains('octo-univer-color-dialog')).toBe(true)
    expect(overlay.hasAttribute('data-prevent-outside-click')).toBe(true)

    fireEvent.mouseDown(view.getByTestId('dialog-inside'))
    expect(caret.className).toContain('is-active')
    fireEvent.mouseDown(document.body)
    expect(caret.className).not.toContain('is-active')
    expect(document.querySelector('.octo-board-color-popover')).toBeNull()
  })
})
