import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { encodeBoardCommentAnchor } from './boardCommentAnchor.ts'

const canvasContext = new Proxy(
  {
    filter: 'none',
    measureText: () => ({ width: 8, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }),
  },
  { get: (target, property) => Reflect.get(target, property) ?? (() => undefined) },
)

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => canvasContext,
})

const { convertToExcalidrawElements, getCommonBounds } = await import('@excalidraw/excalidraw')
const { BoardCommentMarkers } = await import('./BoardCommentMarkers.tsx')

function api(elements: Array<Record<string, unknown>>, scrollX = 0): ExcalidrawImperativeAPI {
  return {
    getSceneElements: () => elements,
    getAppState: () => ({ zoom: { value: 2 }, scrollX, scrollY: 0, offsetLeft: 10, offsetTop: 20 }),
  } as unknown as ExcalidrawImperativeAPI
}

describe('BoardCommentMarkers', () => {
  it('aggregates nearby unresolved roots and activates the first thread', () => {
    const anchor = encodeBoardCommentAnchor({ version: 1, kind: 'point', x: 10, y: 10 })
    const onActivate = vi.fn()
    const { rerender } = render(
      <BoardCommentMarkers
        api={api([])}
        items={[
          { id: 1, anchorStart: anchor, anchorText: 'one', updatedAt: 'now' },
          { id: 2, anchorStart: anchor, anchorText: 'two', updatedAt: 'now' },
        ]}
        activeId={null}
        revision={0}
        getCommonBounds={getCommonBounds as never}
        onActivate={onActivate}
      />,
    )
    const marker = screen.getByRole('button', { name: 'one' })
    expect(marker.querySelector('.octo-board-comment-marker-count')?.textContent).toBe('2')
    expect(marker.querySelector('.octo-board-comment-marker-icon')).not.toBeNull()
    // appState carries a non-zero page offset, but markers use board-host-local coordinates.
    expect(marker.style.left).toBe('20px')
    expect(marker.style.top).toBe('20px')
    fireEvent.click(marker)
    expect(onActivate).toHaveBeenLastCalledWith(1)
    rerender(
      <BoardCommentMarkers
        api={api([])}
        items={[
          { id: 1, anchorStart: anchor, anchorText: 'one', updatedAt: 'now' },
          { id: 2, anchorStart: anchor, anchorText: 'two', updatedAt: 'now' },
        ]}
        activeId={1}
        revision={0}
        getCommonBounds={getCommonBounds as never}
        onActivate={onActivate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'one' }))
    expect(onActivate).toHaveBeenLastCalledWith(2)
  })

  it('places a single element marker at its top-right corner without a count badge', () => {
    const anchor = encodeBoardCommentAnchor({ version: 1, kind: 'element', elementId: 'a', x: 0, y: 0 })
    const [element] = convertToExcalidrawElements([
      { id: 'a', type: 'rectangle', x: 10, y: 20, width: 20, height: 10 },
    ], { regenerateIds: false })
    render(
      <BoardCommentMarkers
        api={api([element])}
        items={[{ id: 1, anchorStart: anchor, anchorText: 'single', updatedAt: 'now' }]}
        activeId={null}
        revision={1}
        getCommonBounds={getCommonBounds as never}
        onActivate={() => {}}
      />,
    )
    const marker = screen.getByRole('button', { name: 'single' })
    expect(marker.style.left).toBe('60px')
    expect(marker.style.top).toBe('40px')
    expect(marker.querySelector('.octo-board-comment-marker-count')).toBeNull()
  })

  it('places a rotated single element marker at its visual top-right bound', () => {
    const [rectangle] = convertToExcalidrawElements([{
      id: 'rotated',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 40,
      height: 20,
      angle: Math.PI / 2,
    }], { regenerateIds: false })
    const anchor = encodeBoardCommentAnchor({ version: 1, kind: 'element', elementId: 'rotated', x: 0, y: 0 })
    render(
      <BoardCommentMarkers
        api={api([rectangle])}
        items={[{ id: 1, anchorStart: anchor, anchorText: 'rotated', updatedAt: 'now' }]}
        activeId={null}
        revision={1}
        getCommonBounds={getCommonBounds as never}
        onActivate={() => {}}
      />,
    )
    const marker = screen.getByRole('button', { name: 'rotated' })
    // Visual bounds are [20, 10, 40, 50], not the raw [10, 20, 50, 40].
    expect(marker.style.left).toBe('80px')
    expect(marker.style.top).toBe('20px')
  })

  it('uses rotated linear bounds and their union for a multi-selection marker', () => {
    const [rectangle, arrow, unrelated] = convertToExcalidrawElements([
      { id: 'rotated', type: 'rectangle', x: 10, y: 20, width: 40, height: 20, angle: Math.PI / 2 },
      { id: 'arrow', type: 'arrow', x: 100, y: 100, width: 40, height: 20, points: [[0, 0], [40, 20]], angle: Math.PI / 2 },
      { id: 'unrelated', type: 'rectangle', x: 1000, y: 1000, width: 500, height: 500 },
    ], { regenerateIds: false })
    const anchor = encodeBoardCommentAnchor({
      version: 1,
      kind: 'element',
      elementId: 'rotated',
      elementIds: ['rotated', 'arrow'],
      x: 0,
      y: 0,
    })
    render(
      <BoardCommentMarkers
        api={api([rectangle, arrow, unrelated])}
        items={[{ id: 1, anchorStart: anchor, anchorText: 'rotated group', updatedAt: 'now' }]}
        activeId={null}
        revision={1}
        getCommonBounds={getCommonBounds as never}
        onActivate={() => {}}
      />,
    )
    const marker = screen.getByRole('button', { name: 'rotated group' })
    // Union bounds are [20, 10, 129.5, 129.5], centred then scaled by zoom=2.
    expect(marker.style.left).toBe('150px')
    expect(marker.style.top).toBe('140px')
  })

  it('tracks a multi-selection bbox and marks a partially deleted target as orphaned', () => {
    const anchor = encodeBoardCommentAnchor({
      version: 1,
      kind: 'element',
      elementId: 'a',
      elementIds: ['a', 'b'],
      x: 0,
      y: 0,
    })
    const [element] = convertToExcalidrawElements([
      { id: 'a', type: 'rectangle', x: 10, y: 20, width: 20, height: 10 },
    ], { regenerateIds: false })
    const { container } = render(
      <BoardCommentMarkers
        api={api([element])}
        items={[{ id: 1, anchorStart: anchor, anchorText: 'group', updatedAt: 'now' }]}
        activeId={1}
        revision={1}
        getCommonBounds={getCommonBounds as never}
        onActivate={() => {}}
      />,
    )
    const marker = screen.getByRole('button', { name: 'group' })
    expect(marker.style.left).toBe('40px')
    expect(marker.style.top).toBe('50px')
    expect(container.querySelector('.is-active.is-orphaned')).toBe(marker)
  })
  it('keeps markers outside the property-panel interaction strip', () => {
    const anchor = encodeBoardCommentAnchor({ version: 1, kind: 'point', x: 10, y: 10 })
    render(
      <BoardCommentMarkers
        api={api([])}
        items={[{ id: 1, anchorStart: anchor, anchorText: 'bounded', updatedAt: 'now' }]}
        activeId={null}
        revision={0}
        bounds={{ left: 200, top: 0, right: 800, bottom: 600 }}
        getCommonBounds={getCommonBounds as never}
        onActivate={() => {}}
      />,
    )
    const marker = screen.getByRole('button', { name: 'bounded' })
    expect(marker.style.left).toBe('212px')
    expect(marker.style.top).toBe('20px')
  })

})
