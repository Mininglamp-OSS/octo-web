// Bridge between the Univer-side sheet mention controller (sheetMention.ts, runs outside React)
// and the React overlay (SheetMentionOverlay.tsx). Univer fires editor keys / ribbon commands
// outside React, so the controller pushes popup state through here and React subscribes — the same
// module-level-hook pattern as formulaBridge.ts.
//
// TWO triggers, both supported:
//   • 'inline'  — the user types `@` inside a cell. The controller sees the cell key stream, so it
//                 owns `query`/`active`; the overlay just renders the list (no search box). Select
//                 replaces the typed `@query` in the cell.
//   • 'button'  — the ribbon @ button (requestSheetMentionOpen). Nothing was typed, so the overlay
//                 renders its OWN search box and owns query/active locally. Select appends a token.

import type { MentionItem } from '../mentions/source.ts'

export type SheetMentionMode = 'inline' | 'button'

/** Popup state the controller pushes; the overlay renders it. */
export interface SheetMentionState {
  visible: boolean
  mode: SheetMentionMode
  /** Viewport coords (px) to anchor the popup — just under the active/editing cell. */
  x: number
  y: number
  /** Loaded candidate list (already merged users+docs). */
  items: MentionItem[]
  /** 'inline' only: query + highlighted row driven by the controller's cell key stream. */
  query: string
  active: number
}

const EMPTY: SheetMentionState = { visible: false, mode: 'inline', x: 0, y: 0, items: [], query: '', active: 0 }

let state: SheetMentionState = EMPTY
const listeners = new Set<() => void>()

export function getSheetMentionState(): SheetMentionState {
  return state
}

export function subscribeSheetMention(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Controller → React: replace popup state and notify subscribers. */
export function setSheetMentionState(next: SheetMentionState): void {
  state = next
  listeners.forEach((cb) => cb())
}

export function hideSheetMention(): void {
  if (state.visible) setSheetMentionState(EMPTY)
}

// Ribbon command → controller: open the mention picker (button mode) for the active cell.
let opener: (() => void) | null = null
export function setSheetMentionOpener(fn: (() => void) | null): void {
  opener = fn
}
export function requestSheetMentionOpen(): void {
  opener?.()
}

// React → controller: the overlay reports a click/keyboard pick; the controller inserts the token.
let selectHandler: ((item: MentionItem) => void) | null = null
export function setSheetMentionSelectHandler(fn: ((item: MentionItem) => void) | null): void {
  selectHandler = fn
}
export function requestSheetMentionSelect(item: MentionItem): void {
  selectHandler?.(item)
}

// React → controller: the overlay was dismissed (Escape / click-away) WITHOUT a pick. This must
// drive the controller's close() so its internal `open`/`mode` flags reset — otherwise the popup
// hides (React state) but the controller stays `open === true`, and the next `@` keystroke sees
// `!this.open === false` and never re-opens the inline picker (inline @ silently dies for the rest
// of the sheet's life). Falls back to a plain state-hide if no controller is registered.
let closer: (() => void) | null = null
export function setSheetMentionCloser(fn: (() => void) | null): void {
  closer = fn
}
export function requestSheetMentionClose(): void {
  if (closer) closer()
  else hideSheetMention()
}
