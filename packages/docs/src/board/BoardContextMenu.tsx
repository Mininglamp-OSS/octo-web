import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import type { BoardCommentOverlayBounds } from './boardCommentOverlay.ts'

export interface BoardContextMenuItem {
  id: string
  label: string
  shortcut?: string
  destructive?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

interface BoardContextMenuProps {
  left: number
  top: number
  items: BoardContextMenuItem[]
  bounds: BoardCommentOverlayBounds
  onClose: () => void
}

const MENU_EDGE_GAP = 8
const MENU_MIN_USABLE_HEIGHT = 40

/** Host-owned, localized replacement for Excalidraw's generic context menu. */
export function BoardContextMenu({ left, top, items, bounds, onClose }: BoardContextMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left, top })
  // Keep at least one action row reachable during transient zero-size layout measurements.
  const availableHeight = Math.max(MENU_MIN_USABLE_HEIGHT, bounds.bottom - bounds.top - MENU_EDGE_GAP * 2)

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) {
      setPosition({ left, top })
      return
    }
    const width = menu.offsetWidth
    const height = Math.min(menu.scrollHeight, availableHeight)
    const minLeft = bounds.left + MENU_EDGE_GAP
    const minTop = bounds.top + MENU_EDGE_GAP
    const maxLeft = Math.max(minLeft, bounds.right - width - MENU_EDGE_GAP)
    const maxTop = Math.max(minTop, bounds.bottom - height - MENU_EDGE_GAP)
    setPosition({
      left: Math.min(Math.max(left, minLeft), maxLeft),
      top: Math.min(Math.max(top, minTop), maxTop),
    })
  }, [availableHeight, bounds, items, left, top])

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()

    const closeOutside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape, true)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="octo-board-context-menu"
      role="menu"
      style={{ left: position.left, top: position.top, maxHeight: availableHeight }}
      onPointerDown={(event) => event.stopPropagation()}
      // Let the browser perform native overflow scrolling (including deltaMode handling), while
      // keeping the wheel event away from Excalidraw's canvas pan/zoom handler.
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
        if (!buttons.length) return
        event.preventDefault()
        event.stopPropagation()
        const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement))
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : event.key === 'ArrowDown'
              ? (current + 1) % buttons.length
              : (current - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}
    >
      {items.map((item) => (
        <div key={item.id} className={item.separatorBefore ? 'octo-board-context-menu-separator' : undefined}>
          <button
            type="button"
            role="menuitem"
            className={item.destructive ? 'is-destructive' : undefined}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
          >
            <span className="octo-board-context-menu-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        </div>
      ))}
    </div>
  )
}
