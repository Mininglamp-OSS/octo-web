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
//
// ROWS ARE NOT BUILT HERE. They are painted by the shared DOM builder
// (mentions/mentionMenu.ts createMentionRowsRenderer) into a ref'd container, the very same
// function the doc editor and every comment composer use. That is deliberate: this surface used to
// render its own flat one-line-per-item list via `mentionItemLabel` ("🤖 @name · AI" / "📄 title"),
// so the sheet was the ONE place that showed an ungrouped, emoji-prefixed candidate list with no Bot
// badge, no description/provenance, no offline state and no empty-state reason. Re-implementing the
// grouped panel in JSX would just recreate that drift in a new dialect, so the markup has exactly
// one definition and both surfaces inherit fixes together.

import { useEffect, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { filterMentionItems, type MentionItem } from '../mentions/source.ts'
import { createMentionRowsRenderer } from '../mentions/mentionMenu.ts'
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
  const listRef = useRef<HTMLDivElement>(null)

  const buttonMode = state.mode === 'button'

  useEffect(() => {
    if (state.visible && buttonMode) {
      setQuery('')
      setActive(0)
      const id = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [state.visible, buttonMode])

  // inline: controller-driven query/active; button: this popup's local state.
  const effQuery = buttonMode ? query : state.query
  const effActive = buttonMode ? active : state.active
  const items = state.visible ? filterMentionItems(state.items, effQuery) : []
  // inline: no box when there is nothing to say — but a Bot notice IS something to say, so a
  // commenter who types `@` still learns why no Bot is offered instead of seeing an empty void.
  const silent = !buttonMode && items.length === 0 && state.botNotice == null

  const choose = (i: number) => {
    const item = items[i]
    // Never dispatch to a row the panel painted as unusable (an offline Bot). The renderer marks it
    // `disabled`, but this popup selects by INDEX, so the guard has to live here too.
    if (!item || isUnpickable(item)) return
    requestSheetMentionSelect(item)
    hideSheetMention()
  }

  // Paint the grouped rows imperatively, and re-paint whenever the visible list changes. The row
  // elements are the builder's own <button>s, so clicks are wired per row (not delegated by index)
  // and the highlight is applied to the element the builder actually produced — index arithmetic
  // never has to be replayed against the DOM.
  useEffect(() => {
    const host = listRef.current
    if (!host) return
    host.replaceChildren()
    if (silent) return
    const rows = createMentionRowsRenderer(() => state.botNotice)(items, host)
    rows.forEach((row) => {
      const idx = items.indexOf(row.item)
      if (row.disabled) return
      if (idx === effActive) row.el.classList.add('is-selected')
      if (buttonMode) row.el.addEventListener('mouseenter', () => setActive(idx))
      // mousedown, not click: fires before the cell/input blur tears the popup down.
      row.el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        choose(idx)
      })
    })
    // `items` is rebuilt each render, so depend on its identity-stable projection instead.
  }, [state.items, state.botNotice, effQuery, effActive, buttonMode, silent])

  if (!state.visible || silent) return null

  return (
    <div
      className="octo-mention-menu octo-suggest-menu"
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 1000 }}
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
              setActive((a) => nextPickable(items, a, 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => nextPickable(items, a, -1))
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
      {buttonMode && items.length === 0 && state.botNotice == null && (
        <div className="octo-suggest-item is-empty">{t('docs.sheet.mention.empty')}</div>
      )}
      <div ref={listRef} />
    </div>
  )
}

/** An offline Bot is rendered but must never be chosen (the panel shows it `disabled`). */
function isUnpickable(item: MentionItem): boolean {
  return item.botOffline === true
}

/**
 * Advance the keyboard cursor by `step`, skipping unpickable rows so ↓ can never park on an offline
 * Bot. Gives up after one full lap, so a list of nothing but offline Bots does not spin forever.
 */
function nextPickable(items: MentionItem[], from: number, step: number): number {
  if (items.length === 0) return 0
  for (let n = 1; n <= items.length; n++) {
    const i = (from + step * n + items.length * n) % items.length
    if (!isUnpickable(items[i])) return i
  }
  return from
}
