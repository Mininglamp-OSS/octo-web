import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { decodeBoardCommentAnchor, type BoardCommentAnchor } from './boardCommentAnchor.ts'
import { clampBoardCommentMarker, type BoardCommentOverlayBounds } from './boardCommentOverlay.ts'

export interface BoardCommentMarkerItem {
  id: number
  anchorStart: string
  anchorText: string
  updatedAt: string
}

export type BoardGetCommonBounds = (elements: readonly any[]) => [number, number, number, number]

interface MarkerGroup {
  key: string
  x: number
  y: number
  items: BoardCommentMarkerItem[]
  orphaned: boolean
}

function resolveAnchor(
  anchor: BoardCommentAnchor,
  api: ExcalidrawImperativeAPI,
  getCommonBounds: BoardGetCommonBounds,
): { x: number; y: number; orphaned: boolean } {
  if (anchor.kind === 'element') {
    const ids = anchor.elementIds ?? [anchor.elementId]
    const elements = api.getSceneElements().filter((item) => ids.includes(item.id) && !item.isDeleted)
    if (elements.length > 0) {
      // Excalidraw's exported bounds primitive is rotation- and point-aware for shapes,
      // lines/arrows, freedraw elements, and multi-selection unions. Raw x/y/width/height
      // describe the unrotated box and would detach a marker from its visual target.
      const [minX, minY, maxX, maxY] = getCommonBounds(elements)
      return {
        // Single element: outside its top-right corner. Multi/group: bbox centre as requested.
        x: ids.length === 1 ? maxX : (minX + maxX) / 2,
        y: ids.length === 1 ? minY : (minY + maxY) / 2,
        orphaned: elements.length !== ids.length,
      }
    }
  }
  return { x: anchor.x, y: anchor.y, orphaned: anchor.kind === 'element' }
}

export function BoardCommentMarkers({
  api,
  items,
  activeId,
  revision,
  bounds,
  rootRef,
  onActivate,
  getCommonBounds,
}: {
  api: ExcalidrawImperativeAPI | null
  items: BoardCommentMarkerItem[]
  activeId: number | null
  revision: number
  bounds?: BoardCommentOverlayBounds
  rootRef?: RefObject<HTMLElement | null>
  onActivate: (id: number) => void
  getCommonBounds: BoardGetCommonBounds | null
}) {
  const [scrollRevision, setScrollRevision] = useState(0)
  useEffect(() => {
    const host = rootRef?.current
    if (!host) return
    let frame: number | null = null
    const refresh = () => {
      if (frame != null) return
      frame = requestAnimationFrame(() => {
        frame = null
        setScrollRevision((value) => value + 1)
      })
    }
    host.addEventListener('octo-board-view-changed', refresh)
    return () => {
      host.removeEventListener('octo-board-view-changed', refresh)
      if (frame != null) cancelAnimationFrame(frame)
    }
  }, [api, rootRef])
  const groups = useMemo(() => {
    if (!api) return []
    const appState = api.getAppState()
    const zoom = appState.zoom?.value ?? 1
    const scrollX = appState.scrollX ?? 0
    const scrollY = appState.scrollY ?? 0
    const grouped = new Map<string, MarkerGroup>()
    for (const item of items) {
      const anchor = decodeBoardCommentAnchor(item.anchorStart)
      if (!anchor) continue
      const scene = getCommonBounds
        ? resolveAnchor(anchor, api, getCommonBounds)
        : { x: anchor.x, y: anchor.y, orphaned: anchor.kind === 'element' }
      // Markers are absolutely positioned inside the board host, so left/top are host-local.
      // Excalidraw offsetLeft/offsetTop are viewport offsets and would double-apply page layout.
      const x = (scene.x + scrollX) * zoom
      const y = (scene.y + scrollY) * zoom
      const key = `${Math.round(x / 20)}:${Math.round(y / 20)}`
      const existing = grouped.get(key)
      if (existing) {
        existing.items.push(item)
        existing.orphaned &&= scene.orphaned
      } else {
        grouped.set(key, { key, x, y, items: [item], orphaned: scene.orphaned })
      }
    }
    const groups = [...grouped.values()]
    if (!bounds) return groups
    return groups.map((group) => ({ ...group, ...clampBoardCommentMarker(group.x, group.y, bounds) }))
  }, [api, items, revision, scrollRevision, bounds, getCommonBounds])

  if (!api) return null
  return (
    <div className="octo-board-comment-markers" aria-label="Board comments">
      {groups.map((group) => {
        const activeIndex = group.items.findIndex((item) => item.id === activeId)
        const active = activeIndex >= 0
        const current = group.items[Math.max(activeIndex, 0)]
        const next = group.items[activeIndex < 0 ? 0 : (activeIndex + 1) % group.items.length]
        return (
          <button
            key={group.key}
            type="button"
            className={`octo-board-comment-marker${active ? ' is-active' : ''}${group.orphaned ? ' is-orphaned' : ''}`}
            style={{ left: Math.round(group.x), top: Math.round(group.y) }}
            title={current.anchorText}
            aria-label={current.anchorText || 'Board comment'}
            onClick={() => onActivate(next.id)}
          >
            <span className="octo-board-comment-marker-icon" aria-hidden="true">💬</span>
            {group.items.length > 1 && <span className="octo-board-comment-marker-count">{group.items.length}</span>}
          </button>
        )
      })}
    </div>
  )
}
