// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoardContextMenu } from './BoardContextMenu.tsx'

afterEach(cleanup)

describe('BoardContextMenu', () => {
  it('runs curated actions and closes', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<BoardContextMenu left={12} top={20} items={[{ id: 'copy', label: 'Copy', shortcut: '⌘C', onSelect }]} onClose={onClose} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy/ }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape and an outside pointer without swallowing non-menu events', () => {
    const onClose = vi.fn()
    render(<><button>Outside</button><BoardContextMenu left={0} top={0} items={[]} onClose={onClose} /></>)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('marks destructive rows semantically', () => {
    render(<BoardContextMenu left={0} top={0} items={[{ id: 'delete', label: 'Delete', destructive: true, onSelect: vi.fn() }]} onClose={vi.fn()} />)
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
        left={490}
        top={390}
        bounds={{ left: 20, top: 10, right: 500, bottom: 400 }}
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

  it('contains pointer and wheel events so the Excalidraw canvas does not move', () => {
    const canvasPointerDown = vi.fn()
    const canvasWheel = vi.fn()
    render(
      <div onPointerDown={canvasPointerDown} onWheel={canvasWheel}>
        <BoardContextMenu left={0} top={0} items={[{ id: 'copy', label: 'Copy', onSelect: vi.fn() }]} onClose={vi.fn()} />
      </div>,
    )
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Copy' }))
    fireEvent.wheel(screen.getByRole('menu'), { deltaY: 80 })
    expect(canvasPointerDown).not.toHaveBeenCalled()
    expect(canvasWheel).not.toHaveBeenCalled()
  })

  it('focuses the first item and supports menu arrow, Home, and End navigation', () => {
    render(
      <BoardContextMenu
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
