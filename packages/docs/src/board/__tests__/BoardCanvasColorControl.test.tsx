import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createRef, type ComponentProps, type MutableRefObject, type ReactNode } from 'react'
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
  const updateScene = vi.fn((scene: { appState?: { viewBackgroundColor?: string }; captureUpdate?: 'IMMEDIATELY' }) => {
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

function renderControl(props: ComponentProps<typeof BoardCanvasColorControl>) {
  const rootRef = createRef<HTMLDivElement>()
  const view = render(<div ref={rootRef}><BoardCanvasColorControl {...props} rootRef={rootRef} /></div>)
  return { ...view, root: rootRef.current! }
}

describe('BoardCanvasColorControl', () => {
  it('renders nothing until the toolbar dispatches the canvas-colour event, then opens the shared picker', () => {
    const { api } = makeApi('#ffffff')
    const view = renderControl({ excalidrawAPI: api })
    // Trigger is the native toolbar button — the control shows no popover on its own.
    expect(document.querySelector('.octo-color-popover')).toBeNull()

    fireEvent(view.root, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))
    expect(document.querySelector('.octo-color-popover')).not.toBeNull()
    // Current colour is controlled off the live appState.
    expect(view.getByTestId('board-canvas-color-control').getAttribute('data-current-color')).toBe('#ffffff')
  })

  it('writes the picked colour back through updateScene({ appState: { viewBackgroundColor } })', () => {
    const { api, updateScene, state } = makeApi('#ffffff')
    const view = renderControl({ excalidrawAPI: api })
    fireEvent(view.root, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))

    fireEvent.click(view.getByTestId('pick'))
    expect(updateScene).toHaveBeenCalledWith({
      appState: { viewBackgroundColor: '#3370ff' },
      captureUpdate: 'IMMEDIATELY',
    })
    expect(state.viewBackgroundColor).toBe('#3370ff')
  })

  it('commits a preset click even though Univer only mutates its internal HSV', () => {
    const { api, updateScene } = makeApi('#ffffff')
    const view = renderControl({ excalidrawAPI: api })
    fireEvent(view.root, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))

    fireEvent.pointerDown(view.getByTestId('preset-white'))
    expect(updateScene).toHaveBeenCalledWith({
      appState: { viewBackgroundColor: '#FFFFFF' },
      captureUpdate: 'IMMEDIATELY',
    })
  })

  it('commits an explicit user pick to the shared doc via onColorCommit (canvas background sync contract authority gate)', () => {
    const { api } = makeApi('#ffffff')
    const onColorCommit = vi.fn()
    const view = renderControl({ excalidrawAPI: api, onColorCommit })
    fireEvent(view.root, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))

    fireEvent.click(view.getByTestId('pick'))
    // The colour reaches both the live canvas (updateScene) and the collab doc (onColorCommit) — and
    // ONLY an explicit pick does so, so a pre-sync onChange default can never be committed.
    expect(onColorCommit).toHaveBeenCalledWith('#3370ff')
  })


  it('binds after a stable root ref is populated after the initial commit and cleans up', () => {
    vi.useFakeTimers()
    const { api } = makeApi('#ffffff')
    const rootRef = createRef<HTMLDivElement>()
    const view = render(<BoardCanvasColorControl excalidrawAPI={api} rootRef={rootRef} />)
    const lateRoot = document.createElement('div')
    document.body.appendChild(lateRoot)
    ;(rootRef as MutableRefObject<HTMLDivElement | null>).current = lateRoot
    act(() => { vi.runOnlyPendingTimers() })
    fireEvent(lateRoot, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))
    expect(document.querySelector('.octo-color-popover')).not.toBeNull()
    view.unmount()
    fireEvent(lateRoot, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))
    lateRoot.remove()
    vi.useRealTimers()
  })

  it('renders nothing and never binds the listener in a read-only session', () => {
    const { api, updateScene } = makeApi('#ffffff')
    const view = renderControl({ excalidrawAPI: api, readOnly: true })
    expect(view.queryByTestId('board-canvas-color-control')).toBeNull()
    fireEvent(document, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))
    expect(document.querySelector('.octo-color-popover')).toBeNull()
    expect(updateScene).not.toHaveBeenCalled()
  })

  it('ignores the same event outside its board root (including the document editor)', () => {
    const { api } = makeApi('#ffffff')
    renderControl({ excalidrawAPI: api })
    fireEvent(document, new CustomEvent(BOARD_CANVAS_COLOR_EVENT))
    expect(document.querySelector('.octo-color-popover')).toBeNull()
  })
})
