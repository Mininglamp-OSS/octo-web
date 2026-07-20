// React overlay for the sheet cell @-mention popup. Mounted once by SheetView; it subscribes to
// the bridge and renders the SAME `octo-mention-menu octo-suggest-menu` popup as the doc-body
// editor and comment composers (shared styling → "同根同源"), positioned at the viewport coords
// the controller pushes (just under the active/editing cell).
//
// Two modes (see sheetMentionBridge.ts):
//   • 'inline'  — the user is typing `@` in the cell, so the CONTROLLER owns query/active (from the
//                 cell key stream). We render the list only; a click reports the pick. Keyboard
//                 nav/select is handled by the controller (the cell, not this popup, has focus).
//   • 'button'  — opened by the ribbon @ button; the cell has no `@` typed, so this popup renders
//                 its OWN search box and owns query/active, and handles ↑/↓/Enter/Esc itself.

import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { filterMentionItems } from '../mentions/source.ts'
import { t } from '../octoweb/index.ts'
import {
  getSheetMentionState,
  subscribeSheetMention,
  hideSheetMention,
  requestSheetMentionSelect,
  requestSheetMentionClose,
} from './sheetMentionBridge.ts'

export function SheetMentionOverlay() {
  const state = useSyncExternalStore(subscribeSheetMention, getSheetMentionState, getSheetMentionState)
  // Local query/active are used in 'button' mode only (this popup owns its search box there).
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const buttonMode = state.mode === 'button'

  useEffect(() => {
    if (state.visible && buttonMode) {
      setQuery('')
      setActive(0)
      const id = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [state.visible, buttonMode])

  if (!state.visible) return null

  // inline: controller-driven query/active; button: this popup's local state.
  const effQuery = buttonMode ? query : state.query
  const effActive = buttonMode ? active : state.active
  const items = filterMentionItems(state.items, effQuery)
  if (!buttonMode && items.length === 0) return null // inline: no box when nothing matches

  const choose = (i: number) => {
    const item = items[i]
    if (!item) return
    requestSheetMentionSelect(item)
    hideSheetMention()
  }

  return (
    <div
      className="octo-mention-menu octo-suggest-menu"
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 1000, minWidth: 180 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {buttonMode && (
        <input
          ref={inputRef}
          className="octo-comment-input octo-mention-search"
          placeholder={t('docs.sheet.mention.search')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (items.length ? (a + 1) % items.length : 0))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0))
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              choose(Math.min(active, items.length - 1))
            } else if (e.key === 'Escape') {
              e.preventDefault()
              requestSheetMentionClose()
            }
          }}
          onBlur={() => setTimeout(requestSheetMentionClose, 150)}
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 4 }}
        />
      )}
      {buttonMode && items.length === 0 ? (
        <div className="octo-suggest-item is-empty">{t('docs.sheet.mention.empty')}</div>
      ) : (
        items.map((item, i) => (
          <div
            key={`${item.type}:${item.id}`}
            className={`octo-suggest-item${i === effActive ? ' is-active' : ''}`}
            role="button"
            tabIndex={-1}
            onMouseEnter={buttonMode ? () => setActive(i) : undefined}
            // mousedown, not click: fires before the cell/input blur tears the popup down.
            onMouseDown={(e) => {
              e.preventDefault()
              choose(i)
            }}
          >
            {item.type === 'doc' ? `📄 ${item.label}` : `@${item.label}`}
          </div>
        ))
      )}
    </div>
  )
}
