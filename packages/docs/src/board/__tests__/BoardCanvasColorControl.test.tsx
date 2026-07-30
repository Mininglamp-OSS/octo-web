import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BoardCanvasColorControl, BOARD_CANVAS_COLOR_EVENT } from '../BoardCanvasColorControl.tsx'

vi.mock('@univerjs/design', async () => {
  const React = await import('react')
  return {
    ConfigProvider: ({ children }: { children: ReactNode }) => children,
    Tooltip: ({ children }: { children: ReactNode }) => children,
    ColorPicker: ({ onChange }: { onChange?: (color: string) => void }) => (
      <div onClick={(event) => event.stopPropagation()}>
        <div data-u-comp="color-picker-presets">
          <button data-testid="preset-white">white preset</button>
        </div>
        <button data-testid="pick" onClick={() => onChange?.('#3370ff')}>custom confirm</button>
        <div role="dialog"><div data-u-comp="color-picker-spectrum" /></div>
      </div>
    ),
  }
})

vi.mock('../../octoweb/index.ts', () => ({
  t: (key: string) => key,
  i18n: { getLocale: () => 'en-US' },
}))

afterEach(() => {
  cleanup()
  document.getElementById('octo-univer-portal')?.remove()
})

/** Minimal imperative-API stub: an onChange emitter + a mutable appState the control reads/writes. */
function makeApi(initial = '#ffffff') {
  const listeners = new Set<() => void>()
  const state = { viewBackgroundColor: initial }
  const updateScene = vi.fn((scene: { appState?: { viewBackgroundColor?: string } }) => {
    if (scene.appState?.viewBackgroundColor) state.viewBackgroundColor = scene.appState.viewBackgroundColor
    listeners.forEach((fn) => fn())
  })
  return {
    api: {
      onChange: (fn: () => void) => {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      getAppState: () => state,
      updateScene,
    } as never,
    updateScene,
    state,
  }
}

describe('BoardCanvasColorControl', () => {
  it('renders nothing until the toolbar dispatches the canvas-colour event, then opens the shared picker', () => {
    const { api } = makeApi('#ffffff')
    const view = render(<BoardCanvasColorControl excalidrawAPI={api} />)
    // Trigger is the native toolbar button — the control shows no popover on its own.
    expect(document.querySelector('.octo-color-popover')).toBeNull()

    fireEvent(document, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))
    expect(document.querySelector('.octo-color-popover')).not.toBeNull()
    // Current colour is controlled off the live appState.
    expect(view.getByTestId('board-canvas-color-control').getAttribute('data-current-color')).toBe('#ffffff')
  })

  it('writes the picked colour back through updateScene({ appState: { viewBackgroundColor } })', () => {
    const { api, updateScene, state } = makeApi('#ffffff')
    const view = render(<BoardCanvasColorControl excalidrawAPI={api} />)
    fireEvent(document, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))

    fireEvent.click(view.getByTestId('pick'))
    expect(updateScene).toHaveBeenCalledWith({ appState: { viewBackgroundColor: '#3370ff' } })
    expect(state.viewBackgroundColor).toBe('#3370ff')
  })

  it('commits a preset click even though Univer only mutates its internal HSV', () => {
    const { api, updateScene } = makeApi('#ffffff')
    const view = render(<BoardCanvasColorControl excalidrawAPI={api} />)
    fireEvent(document, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))

    fireEvent.pointerDown(view.getByTestId('preset-white'))
    expect(updateScene).toHaveBeenCalledWith({ appState: { viewBackgroundColor: '#FFFFFF' } })
  })

  it('commits an explicit user pick to the shared doc via onColorCommit (PR #1161 authority gate)', () => {
    const { api } = makeApi('#ffffff')
    const onColorCommit = vi.fn()
    const view = render(<BoardCanvasColorControl excalidrawAPI={api} onColorCommit={onColorCommit} />)
    fireEvent(document, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))

    fireEvent.click(view.getByTestId('pick'))
    // The colour reaches both the live canvas (updateScene) and the collab doc (onColorCommit) — and
    // ONLY an explicit pick does so, so a pre-sync onChange default can never be committed.
    expect(onColorCommit).toHaveBeenCalledWith('#3370ff')
  })

  it('renders nothing and never binds the listener in a read-only session', () => {
    const { api, updateScene } = makeApi('#ffffff')
    const view = render(<BoardCanvasColorControl excalidrawAPI={api} readOnly />)
    expect(view.container.firstChild).toBeNull()
    fireEvent(document, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))
    expect(document.querySelector('.octo-color-popover')).toBeNull()
    expect(updateScene).not.toHaveBeenCalled()
  })
})
