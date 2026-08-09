// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoardContextMenu } from './BoardContextMenu.tsx'

const bounds = { left: 0, top: 0, right: 600, bottom: 600 }

afterEach(cleanup)

describe('BoardContextMenu', () => {
  it('runs curated actions and closes', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<BoardContextMenu bounds={bounds} left={12} top={20} items={[{ id: 'copy', label: 'Copy', shortcut: '⌘C', onSelect }]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy/ }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('waits for an async action and closes only after success', async () => {
    let finish: ((value: boolean) => void) | undefined
    const onClose = vi.fn()
    render(<BoardContextMenu bounds={bounds} left={12} top={20} items={[{
      id: 'paste',
      label: 'Paste',
      onSelect: () => new Promise<boolean>((resolve) => { finish = resolve }),
    }]} onClose={onClose} />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))
    expect(onClose).not.toHaveBeenCalled()
    finish?.(true)
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('keeps the menu open when an async action returns false or rejects', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<BoardContextMenu bounds={bounds} left={12} top={20} items={[{
      id: 'paste',
      label: 'Paste',
      onSelect: async () => false,
    }]} onClose={onClose} />)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))
    await Promise.resolve()
    expect(onClose).not.toHaveBeenCalled()

    rerender(<BoardContextMenu bounds={bounds} left={12} top={20} items={[{
      id: 'paste',
      label: 'Paste',
      onSelect: async () => { throw new Error('clipboard denied') },
    }]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))
    await Promise.resolve()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape and an outside pointer without swallowing non-menu events', () => {
    const onClose = vi.fn()
    render(<><button>Outside</button><BoardContextMenu bounds={bounds} left={0} top={0} items={[]} onClose={onClose} /></>)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('marks destructive rows semantically', () => {
    render(<BoardContextMenu bounds={bounds} left={0} top={0} items={[{ id: 'delete', label: 'Delete', destructive: true, onSelect: vi.fn() }]} onClose={vi.fn()} />)
    expect(screen.getByRole('menuitem', { name: 'Delete' }).classList.contains('is-destructive')).toBe(true)
  })

  it('clamps an oversized menu inside the safe viewport and scrolls internally', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(760)
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `item-${index}`,
      label: `Item ${index}`,
      onSelect: vi.fn(),
    }))
    render(
      <BoardContextMenu
        bounds={{ left: 20, top: 10, right: 500, bottom: 400 }}
        left={490}
        top={390}
        items={items}
        onClose={vi.fn()}
      />,
    )
    const menu = screen.getByRole('menu')
    expect(menu.style.maxHeight).toBe('374px')
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(252)
    expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(18)
    width.mockRestore()
    height.mockRestore()
  })

  it('clamps a menu opened near the lower edge instead of collapsing it', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240)
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(760)
    render(
      <BoardContextMenu
        bounds={bounds}
        left={20}
        top={580}
        items={Array.from({ length: 20 }, (_, index) => ({
          id: `item-${index}`,
          label: `Item ${index}`,
          onSelect: vi.fn(),
        }))}
        onClose={vi.fn()}
      />,
    )

    const menu = screen.getByRole('menu')
    expect(menu.style.maxHeight).toBe('584px')
    expect(Number.parseFloat(menu.style.top)).toBe(8)
    width.mockRestore()
    height.mockRestore()
  })

  it('keeps one action row usable during a transient zero-height measurement', () => {
    render(
      <BoardContextMenu
        bounds={{ left: 0, top: 0, right: 0, bottom: 0 }}
        left={0}
        top={0}
        items={[{ id: 'copy', label: 'Copy', onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('menu').style.maxHeight).toBe('40px')
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeTruthy()
  })

  it('contains pointer and wheel events so the Excalidraw canvas does not move', () => {
    const canvasPointerDown = vi.fn()
    const canvasWheel = vi.fn()
    render(
      <div onPointerDown={canvasPointerDown} onWheel={canvasWheel}>
        <BoardContextMenu bounds={bounds} left={0} top={0} items={[{ id: 'copy', label: 'Copy', onSelect: vi.fn() }]} onClose={vi.fn()} />
      </div>,
    )
    const menu = screen.getByRole('menu')
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Copy' }))
    fireEvent.wheel(menu, { deltaY: 80 })
    expect(canvasPointerDown).not.toHaveBeenCalled()
    expect(canvasWheel).not.toHaveBeenCalled()
  })

  it('focuses the first item and supports menu arrow, Home, and End navigation', () => {
    render(
      <BoardContextMenu
        bounds={bounds}
        left={0}
        top={0}
        items={['One', 'Two', 'Three'].map((label) => ({ id: label, label, onSelect: vi.fn() }))}
        onClose={vi.fn()}
      />,
    )
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2], { key: 'Home' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
  })
})
